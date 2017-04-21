---
title: CQRS和Event Souring系列（六）： 第一个正式Axon例子
date: 2017-03-30 19:45:16
tags:
- CQRS
- axon
- DDD
- eventsourcing
---
> 前面对Axon的基本概念和基本操作做了简介，从本章开始，我们将一步步使用AxonFramework完成一个真正CQRS&EventSourcing的例子。

## 设计
回顾一下使用AxonFramework应用的架构
![](/images/2017/03/detailed-architecture-overview.png)

Command端Repository和Query端的Database是解耦的，完全可以使用不同的持久化技术，我们来尝试用MongoDB做Command端的Repository，而MySQL做Query的数据库。

### 例子描述
我们尝试完成一个简单的case：后台人员创建商品，用户选定若干商品后下单购买。
商品定义：Product(id, name, stock, price)
商品创建流程：
`CreateProductCommand` -> new `ProductAggregate` instance -> `ProductCreatedEvent`

订单定义： Order(id, username, payment, products)
订单创建流程：
`CreateOrderCommand` -> new `OrderAggregate` instance -> `OrderCreatedEvent`
创建商品时，我们只接收商品ID，去查询商品的具体信息，这样来学习如何在handler内去查询Aggregate。

## Command端实现
Command端实现与前面几篇文章基本一致，需要定义Aggregate、Command，然后提供配置即可。
### Aggregate
`ProductAggregate`
```java
@Aggregate
public class ProductAggregate {

    private static final Logger LOGGER = getLogger(ProductAggregate.class);

    @AggregateIdentifier
    private String id;
    private String name;
    private int stock;
    private long price;

    public ProductAggregate() {
    }

    @CommandHandler
    public ProductAggregate(CreateProductCommand command) {
        apply(new ProductCreatedEvent(command.getId(),command.getName(),command.getPrice(),command.getStock()));
    }

    @EventHandler
    public void on(ProductCreatedEvent event){
        this.id = event.getId();
        this.name = event.getName();
        this.price = event.getPrice();
        this.stock = event.getStock();
        LOGGER.debug("Product [{}] {} {}x{} is created.", id,name,price,stock);
    }

    // getter and setter
    ......
}
```
`OrderAggregate`
```java
@Aggregate
public class OrderAggregate {

    @AggregateIdentifier
    private OrderId id;
    private String username;
    private double payment;

    @AggregateMember
    private Map<String, OrderProduct> products;

    public OrderAggregate(){}

    public OrderAggregate(OrderId id, String username, Map<String, OrderProduct> products) {
        apply(new OrderCreatedEvent(id, username, products));
    }

    public OrderId getId() {
        return id;
    }

    public String getUsername() {
        return username;
    }

    public Map<String, OrderProduct> getProducts() {
        return products;
    }

    @EventHandler
    public void on(OrderCreatedEvent event){
        this.id = event.getOrderId();
        this.username = event.getUsername();
        this.products = event.getProducts();
        computePrice();
    }

    private void computePrice() {
        products.forEach((id, product) -> {
            payment += product.getPrice() * product.getAmount();
        });
    }

    /**
     * Divided 100 here because of the transformation of accuracy
     *
     * @return
     */
    public double getPayment() {
        return payment/100;
    }

    public void addProduct(OrderProduct product){
        this.products.put(product.getId(), product);
        payment += product.getPrice() * product.getAmount();
    }

    public void removeProduct(String productId){
        OrderProduct product = this.products.remove(productId);
        payment = payment - product.getPrice() * product.getAmount();
    }
}
```
这里，我并没有像ProductAggregate一样，把CreateOrderCommand放到OrderAggregate的构造器中去处理，原因是在创建订单时，由于需要知道商品的单价，所以要根据商品id查询商品信息，因为涉及到了其他Aggregate操作，特地单独创建一个OrderHandler来处理。
```java
@Component
public class OrderHandler {

    private static final Logger LOGGER = getLogger(OrderHandler.class);

    @Autowired
    private Repository<OrderAggregate> repository;

    @Autowired
    private Repository<ProductAggregate> productRepository;

    @Autowired
    private EventBus eventBus;

    @CommandHandler
    public void handle(CreateOrderCommand command) throws Exception {
        Map<String, OrderProduct> products = new HashMap<>();
        command.getProducts().forEach((productId,number)->{
            LOGGER.debug("Loading product information with productId: {}",productId);
            Aggregate<ProductAggregate> aggregate = productRepository.load(productId);
            products.put(productId,
                    new OrderProduct(productId,
                            aggregate.invoke(productAggregate -> productAggregate.getName()),
                            aggregate.invoke(productAggregate -> productAggregate.getPrice()),
                            number));
        });
        repository.newInstance(() -> new OrderAggregate(command.getOrderId(), command.getUsername(), products));
    }
}
```
如果查看`org.axonframework.commandhandling.model.Repository<T>`接口的定义，会发现里面只有三个方法：
```java
public interface Repository<T> {

    /**
     * Load the aggregate with the given unique identifier. No version checks are done when loading an aggregate,
     * meaning that concurrent access will not be checked for.
     *
     * @param aggregateIdentifier The identifier of the aggregate to load
     * @return The aggregate root with the given identifier.
     * @throws AggregateNotFoundException if aggregate with given id cannot be found
     */
    Aggregate<T> load(String aggregateIdentifier);

    /**
     * Load the aggregate with the given unique identifier.
     *
     * @param aggregateIdentifier The identifier of the aggregate to load
     * @param expectedVersion     The expected version of the loaded aggregate
     * @return The aggregate root with the given identifier.
     * @throws AggregateNotFoundException if aggregate with given id cannot be found
     */
    Aggregate<T> load(String aggregateIdentifier, Long expectedVersion);

    /**
     * Creates a new managed instance for the aggregate, using the given {@code factoryMethod}
     * to instantiate the aggregate's root.
     *
     * @param factoryMethod The method to create the aggregate's root instance
     * @return an Aggregate instance describing the aggregate's state
     * @throws Exception when the factoryMethod throws an exception
     */
    Aggregate<T> newInstance(Callable<T> factoryMethod) throws Exception;
}
```
有人会疑惑了，为什么没有Delete和Update？
先说update，这个Repository其实是对Aggregate的操作，EventSourcing中对Aggregate所有的变化都是通过Event来实现的，所以在调用apply(EventMessage)时，Event就已经被持久化了，`EventHandler`在处理该Event时，就已经实现了对Aggregate的update。
而Delete没有，很简单，EventSourcing脱胎于现实概念，你见过现实生活中把一个事物真正“delete”掉吗？估计得使用高能量子炮把东西轰成原子吧。
所以，只会有一个把这个Aggregate标为失效的标志，Axon中，在Aggregate内部可以直接调用markDeleted()来表示这个Aggregate被“delete”掉了，其实只是不能被load出来罢了。
由于Repository默认返回的是同一类型Aggregate<T>，所以我们取属性就没那么简单了，只能通过invoke来调用get方法。是不是觉得很麻烦？因为其实CQRS压根不推荐直接从Repository直接query Aggregate来查询，而是调用Query端。

### Command
command的实现因为都是POJO我就不贴代码了，可以直接看源码。
这里写一下基于SpringWeb的Controller类（引入`spring-boot-starter-web`包），以创建Product为例
```java
@RestController
@RequestMapping("/product")
public class ProductController {

    private static final Logger LOGGER = getLogger(ProductController.class);

    @Autowired
    private CommandGateway commandGateway;

    @RequestMapping(value = "/{id}", method = RequestMethod.POST)
    public void create(@PathVariable(value = "id") String id,
                       @RequestParam(value = "name", required = true) String name,
                       @RequestParam(value = "price", required = true) long price,
                       @RequestParam(value = "stock",required = true) int stock,
                       HttpServletResponse response) {

        LOGGER.debug("Adding Product [{}] '{}' {}x{}", id, name, price, stock);

        try {
            // multiply 100 on the price to avoid float number
            CreateProductCommand command = new CreateProductCommand(id,name,price*100,stock);
            commandGateway.sendAndWait(command);
            response.setStatus(HttpServletResponse.SC_CREATED);// Set up the 201 CREATED response
            return;
        } catch (CommandExecutionException cex) {
            LOGGER.warn("Add Command FAILED with Message: {}", cex.getMessage());
            response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
            if (null != cex.getCause()) {
                LOGGER.warn("Caused by: {} {}", cex.getCause().getClass().getName(), cex.getCause().getMessage());
                if (cex.getCause() instanceof ConcurrencyException) {
                    LOGGER.warn("A duplicate product with the same ID [{}] already exists.", id);
                    response.setStatus(HttpServletResponse.SC_CONFLICT);
                }
            }
        }
    }
}
```
`CommandGateway`提供了四种发送Comman的方法：
- send(command, CommandCallback)  发送command，根据执行结果调用`CommandCallback`中的`onSuccess`或`onFailure`方法
- sendAndWait(command) 发送完command，等待执行完成并返回结果
- sendAndWait(command, timeout, TimeUnit) 这个好理解，比上面多了一个超时
- send(command) 该方法返回一个`CompletableFuture`，不用等待command的执行，立刻返回。结果通过future获取。

### Repository
由于我们要使用`axon-mongo`，而非默认的jpa，所以必须得手动指定两个Aggregate的Repository，以其中一个为例：
```java
@Configuration
public class ProductConfig {

    @Autowired
    private EventStore eventStore;

    @Bean
    @Scope("prototype")
    public ProductAggregate productAggregate(){
        return new ProductAggregate();
    }

    @Bean
    public AggregateFactory<ProductAggregate> productAggregateAggregateFactory(){
        SpringPrototypeAggregateFactory<ProductAggregate> aggregateFactory = new SpringPrototypeAggregateFactory<>();
        aggregateFactory.setPrototypeBeanName("productAggregate");
        return aggregateFactory;
    }

    @Bean
    public Repository<ProductAggregate> productAggregateRepository(){
        EventSourcingRepository<ProductAggregate> repository = new EventSourcingRepository<ProductAggregate>(
                productAggregateAggregateFactory(),
                eventStore
        );
        return repository;
    }
}
```
使用EventSourcingRepository，必须指定一个AggregateFactory用来反射生成Aggregate的，所以我们这里定义了Aggregate的prototype，并把它注册到AggregateFactory中去。
这样在系统启动时，读取历史Event进行ES还原时，就可以真实再现Aggregate的状态。

### 配置
前面使用MySQL作为EventStorage是不是感到不爽，那么我们通过引入`axon-mongo`依赖，使用MongoDB来做EventStorage。
pom的修改我就不写了，着重看下相关配置
先是修改application.property
```yml
# mongo
mongodb.url=10.1.110.24
mongodb.port=27017
# mongodb.username=
# mongodb.password=
mongodb.dbname=axon
mongodb.events.collection.name=events
mongodb.events.snapshot.collection.name=snapshots
```
通过Spring提供的@Value注解在具体的Configuration类里读取。
```java
@Configuration
public class CommandRepositoryConfiguration {

    @Value("${mongodb.url}")
    private String mongoUrl;

    @Value("${mongodb.dbname}")
    private String mongoDbName;

    @Value("${mongodb.events.collection.name}")
    private String eventsCollectionName;

    @Value("${mongodb.events.snapshot.collection.name}")
    private String snapshotCollectionName;

    @Bean
    public Serializer axonJsonSerializer() {
        return new JacksonSerializer();
    }

    @Bean
    public EventStorageEngine eventStorageEngine(){
        return new MongoEventStorageEngine(
                axonJsonSerializer(),null, axonMongoTemplate(), new DocumentPerEventStorageStrategy());
    }

    @Bean(name = "axonMongoTemplate")
    public MongoTemplate axonMongoTemplate() {
        MongoTemplate template = new DefaultMongoTemplate(mongoClient(), mongoDbName, eventsCollectionName, snapshotCollectionName);
        return template;
    }

    @Bean
    public MongoClient mongoClient(){
        MongoFactory mongoFactory = new MongoFactory();
        mongoFactory.setMongoAddresses(Arrays.asList(new ServerAddress(mongoUrl)));
        return mongoFactory.createMongo();
    }
}
```
用Jacson做序列化器，MongoClient提供了具体连接实现，MongoTemplate指定了db名称、存放event的collection名称、存放snapshot的collection名称。（snapshot的概念以后再解释）
中间一个参数是做不同版本Event间兼容的，我们先留null。
`EventStorageEngine`指定`MongoEventStorageEngine`，`spring-boot-autoconfigure`中的`AxonAutoConfiguration`就会帮你把它注入到Axon的配置器中。
这里指的注意的是，**使用Jackson做序列化器时，对应的entity的所有需要持久化的field必须都有public getter方法**，因为Jackson在反射时默认只读public修饰符的field，否则就会报
com.fasterxml.jackson.databind.JsonMappingException: No serializer found for class com.edi.learn.axon.common.domain.OrderId and no properties discovered to create BeanSerializer (to avoid exception, disable SerializationFeature.FAIL_ON_EMPTY_BEANS) (through reference chain: com.edi.learn.axon.common.events.OrderCreatedEvent["orderId"])
错误。如果确实不想写，那么在Entity的class声明前加上`@JsonAutoDetect(fieldVisibility=JsonAutoDetect.Visibility.ANY)`
到此，Command端的实现已基本完成（Event我没写，因为与前文类似），那么我们来看看Query端。

## Query端实现
AxonFramework的Query端其实并没有特别的，我们只需要实现一些`EventHandler`来处理Command端产生的事件，来更新Query端的数据库就行了。
这里我就使用JPA的MySQL实现，spring提供了`spring-boot-starter-data-rest`，为JPA Repository增加了HateOas风格的REST接口，非常简单，非常方便，堪称无脑。
先定义三个Entity
```java
@Entity
public class ProductEntry {

  @Id
  private String id;
  @Column
  private String name;
  @Column
  private long price;
  @Column
  private int stock;

  public ProductEntry() {
  }

  public ProductEntry(String id, String name, long price, int stock) {
      this.id = id;
      this.name = name;
      this.price = price;
      this.stock = stock;
  }
  // getter & setter
  ......
}

@Entity
public class OrderEntry {
  @Id
  private String id;
  @Column
  private String username;
  @Column
  private double payment;
  @OneToMany(fetch = FetchType.EAGER, cascade = CascadeType.ALL)
  @JoinColumn(name = "order_id")
  @MapKey(name = "id")
  private Map<String, OrderProductEntry> products;

  public OrderEntry() {
  }

  public OrderEntry(String id, String username, Map<String, OrderProductEntry> products) {
      this.id = id;
      this.username = username;
      this.payment = payment;
      this.products = products;
  }
  // getter & setter
  ......
}

@Entity
public class OrderProductEntry {
  @Id
  @GeneratedValue
  private Long jpaId;
  private String id;
  @Column
  private String name;
  @Column
  private long price;
  @Column
  private int amount;

  public OrderProductEntry() {
  }

  public OrderProductEntry(String id, String name, long price, int amount) {
      this.id = id;
      this.name = name;
      this.price = price;
      this.amount = amount;
  }

  // getter & setter
  ......
}
```
比较简单，唯一需要注意的是ProductEntry和OrderEntry之间的一对多关系。
然后为它们创建两个Repository
```
@RepositoryRestResource(collectionResourceRel = "orders", path = "orders")
public interface OrderEntryRepository extends PagingAndSortingRepository<OrderEntry, String> {}
@RepositoryRestResource(collectionResourceRel = "products", path = "products")
public interface ProductEntryRepository extends PagingAndSortingRepository<ProductEntry, String> {}
```
是不是很简单？最后定义handler，为省篇幅，我只写一个
```java
@Component
public class OrderEventHandler {

    private static final Logger LOGGER = getLogger(OrderEventHandler.class);

    @Autowired
    private OrderEntryRepository repository;

    @EventHandler
    public void on(OrderCreatedEvent event){
        Map<String, OrderProductEntry> map = new HashMap<>();
        event.getProducts().forEach((id, product)->{
            map.put(id,
                    new OrderProductEntry(
                            product.getId(),
                            product.getName(),
                            product.getPrice(),
                            product.getAmount()));
        });
        OrderEntry order = new OrderEntry(event.getOrderId().toString(), event.getUsername(), map);
        repository.save(order);
    }
}
```

## 启动类
由于我们使用了axon提供的`MongoEventStorageEngine`，其内部也使用了JPA，所以我们在启动类还需要把Axon帮我们转Entity的一些类也加到EntityScan中去
```java
@SpringBootApplication
@ComponentScan(basePackages = {"com.edi.learn"})
@EntityScan(basePackages = {"com.edi.learn",
        "org.axonframework.eventsourcing.eventstore.jpa",
        "org.axonframework.eventhandling.saga.repository.jpa",
        "org.axonframework.eventhandling.tokenstore.jpa"})
@EnableJpaRepositories(basePackages = {"com.edi.learn.axon.query"})
public class Application {

    private static final Logger LOGGER = getLogger(Application.class);

    public static void main(String args[]){
        SpringApplication.run(Application.class, args);
    }
}
```

启动后，用POST发送请求http://127.0.0.1:8080/product/1?name=ttt&price=10&stock=100 ，查询mongoDB：
```
> use axon
> show collections
events
snapshots
system.indexes
> db.events.find().pretty()
{
        "_id" : ObjectId("58dd181073bc0c0fb86d895e"),
        "aggregateIdentifier" : "1",
        "type" : "ProductAggregate",
        "sequenceNumber" : NumberLong(0),
        "serializedPayload" : "{\"id\":\"1\",\"name\":\"ttt\",\"price\":1000,\"stock\":100}",
        "timestamp" : "2017-03-30T14:37:04.075Z",
        "payloadType" : "com.edi.learn.axon.common.events.ProductCreatedEvent",
        "payloadRevision" : null,
        "serializedMetaData" : "{\"traceId\":\"4a298ed4-0d53-402a-ae6b-d79cc5e193bf\",\"correlationId\":\"4a298ed4-0d53-402a-ae6b-d79cc5e193bf\"}",
        "eventIdentifier" : "500f3a8f-7c02-4e8e-bb9c-7b676224ce5c"
}
```
可以看到生成的EventMessage，与前篇文章中MySQL表里内容基本一致。
再去看下MySQL库的product_entry表，有记录

| id | name | price | stock |
| -- | -- |
| 1 | ttt | 1000 | 100 |

用GET请求http://localhost:8080/products 会返回当前所有product信息，加上id http://localhost:8080/products/1 就会返回刚才创建的product。

本篇对应代码：https://github.com/EdisonXu/sbs-axon/tree/master/lesson-4
