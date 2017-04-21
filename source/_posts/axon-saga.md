---
title: CQRS和Event Souring系列（七）：Saga的使用
date: 2017-03-31 11:37:32
tags:
- CQRS
- axon
- DDD
- eventsourcing
---
> 在上一篇里面，我们正式的使用了CQRS模式完成了AXON的第一个真正的例子，但是细心的朋友会发现一个问题，创建订单时并没有检查商品库存。
> 库存是否足够直接回导致订单状态的成功与否，在并发时可能还会出现超卖。当库存不足时还需要回滚订单，所以这里出现了复杂的跨Aggregate事务问题。
> Saga就是为解决这里复杂流程而生的。

## **Saga**
**Saga** 这个名词最早是由Hector Garcia-Molina和Kenneth Salem写的[Sagas](http://www.cs.cornell.edu/andru/cs711/2002fa/reading/sagas.pdf)这篇论文里提出来的，但其实Saga并不是什么新事物，在我们传统的系统设计中，它有个更熟悉的名字——“ProcessManager”，只是换了个马甲，还是干同样的事——组合一组逻辑处理复杂流程。
但它与我们平常理解的“ProgressManager”又有不同，它的提出，最早是是为了解决分布式系统中长时间运行事务(long-running business process)的问题，把单一的transaction按照步骤分成一组若干子transaction，通过补偿机制实现最终一致性。
举个例子，在一个交易环节中有下单支付两个步骤，如果是传统方式，两个步骤在一个事务里，统一成功或回滚，然而如果支付时间很长，那么就会导致第一步，即下单这里所占用的资源被长时间锁定，可能会对系统可用性造成影响。如果用Saga来实现，那么下单是一个独立事务，下单的事务先提交，提交成功后开始支付的事务，如果支付成功，则支付的事务也提交，整个流程就算完成，但是如果支付事务执行失败，那么支付需要回滚，因为这时下单事务已经提交，则需要对下单操作进行补偿操作（可能是回滚，也可能是变成新状态）。
可以看到Saga是牺牲了数据的强一致性，实现最终一致性。

>Saga的概念使得强一致性的分布式事务不再是唯一的解决方案，通过保证事务中每一步都可以一个补偿机制，在发生错误后执行补偿事务来保证系统的可用性和最终一致性。

在CQRS中，我们尽量遵从“聚合尽量设计的小，且一次修改只修改一个聚合”的原则（与OO中高内聚，低耦合的原则相同），所以当我们需要完成一个复杂流程时，就可能涉及到对多个Aggregate状态的改变，我们就可以把整个过程管理统一放到Saga来定义。

## 设计
把我们的订单创建流程修改成以下：
![](/images/2017/03/flowchart.png)

## 创建Command和Event
在上一篇例子的基础上，创建如下Command和Event
-ReserveProductCommand (orderId, productId, number)
-RollbackReservationCommand (orderId, productId, number)
-ConfirmOrderCommand (orderId)
-RollbackOrderCommand (orderId)
-ProductReservedEvent (orderId, productId, number)
-ProductNotEnoughEvent (orderId, productId)
-OrderCancelledEvent (orderId)
-OrderConfirmedEvent (orderId)

都是POJO，这里我就不放代码了。具体可以去源代码看。

## 创建Saga
```java
@Saga
public class OrderSaga {

    private static final Logger LOGGER = getLogger(OrderSaga.class);

    private OrderId orderIdentifier;
    private Map<String, OrderProduct> toReserve;
    private Map<String, OrderProduct> toRollback;
    private int toReserveNumber;
    private boolean needRollback;

    @Autowired
    private transient CommandGateway commandGateway;

    @StartSaga
    @SagaEventHandler(associationProperty = "orderId")
    public void handle(OrderCreatedEvent event){
        this.orderIdentifier = event.getOrderId();
        this.toReserve = event.getProducts();
        toRollback = new HashMap<>();
        toReserveNumber = toReserve.size();
        event.getProducts().forEach((id,product)->{
            ReserveProductCommand command = new ReserveProductCommand(orderIdentifier, id, product.getAmount());
            commandGateway.send(command);
        });
    }

    @SagaEventHandler(associationProperty = "orderId")
    public void handle(ProductNotEnoughEvent event){
        LOGGER.info("No enough item to buy");
        toReserveNumber--;
        needRollback=true;
        if(toReserveNumber==0)
            tryFinish();
    }

    private void tryFinish() {
        if(needRollback){
            toReserve.forEach((id, product)->{
                if(!product.isReserved())
                    return;
                toRollback.put(id, product);
                commandGateway.send(new RollbackReservationCommand(orderIdentifier, id, product.getAmount()));
            });
            if(toRollback.isEmpty())
                commandGateway.send(new RollbackOrderCommand(orderIdentifier));
            return;
        }
        commandGateway.send(new ConfirmOrderCommand(orderIdentifier));
    }

    @SagaEventHandler(associationProperty = "orderId")
    public void handle(ReserveCancelledEvent event){
        toRollback.remove(event.getProductId());
        if(toRollback.isEmpty())
            commandGateway.send(new RollbackOrderCommand(event.getOrderId()));
    }

    @SagaEventHandler(associationProperty = "id", keyName = "orderId")
    @EndSaga
    public void handle(OrderCancelledEvent event) throws OrderCreateFailedException {
        LOGGER.info("Order {} is cancelled", event.getId());
        // throw exception here will not cause the onFailure() method in the command callback
        //throw new OrderCreateFailedException("Not enough product to reserve!");
    }

    @SagaEventHandler(associationProperty = "orderId")
    public void handle(ProductReservedEvent event){
        OrderProduct reservedProduct = toReserve.get(event.getProductId());
        reservedProduct.setReserved(true);
        toReserveNumber--;
        if(toReserveNumber ==0)
            tryFinish();
    }

    @SagaEventHandler(associationProperty = "id", keyName = "orderId")
    @EndSaga
    public void handle(OrderConfirmedEvent event){
        LOGGER.info("Order {} is confirmed", event.getId());
    }
}
```
### Saga的启动和结束
Axon中通过`@Saga`注解标识Saga。Saga有起点和终点，必须以`@StartSaga`和`@EndSaga`区分清楚。一个Saga的起点可能只有一个，但终点可能有好几个，对应流程的不同结果。
默认情况下，只有在找不到同类型已存在的Saga instance时，才会创建一个新的Saga。但是可以通过更改`@StartSaga`中的`forceNew`为true让它每次都新建一个。
只有当`@EndSaga`对应的方法被顺利执行，Saga才会结束，但也可以直接从Saga内部调用`end()`方法强制结束。

### EventHandling
Saga通过`@SagaEventHandler`注解来标明EventHandler，与普通EventHandler基本一致，唯一的不同是，普通的EventHandler会接受所有对应的Event，而Saga的EventHandler只处理与其关联过的Event。
当被注解`@StartSaga`的方法调用时，axon默认会根据当前`@SagaEventHandler`中的`associationProperty`去找Event中的field，然后把它的值与当前Saga进行关联，类似`<saga_id,<key,value>>`这种形式。
一旦产生关联，该Saga在遇到同一Event时，只会处理`<key,value>`与已关联值完全一致的Event。例如，有两个`OrderCreatedEvent`，我们定义`associationProperty ="orderId"`，两个event的orderId分别为1、2，当Saga创建时接受了orderId=1的`OrderCreatedEvent`后，值为2的Event它就不再处理了。
也可以在Saga内直接调用`associateWith(String key, String/Number value)`来做这个关联。例如，
```java
public class OrderManagementSaga {
private boolean paid = false;
private boolean delivered = false;
@Inject
private transient CommandGateway commandGateway;
  @StartSaga
  @SagaEventHandler(associationProperty = "orderId")
  public void handle(OrderCreatedEvent event) {
    // client generated identifiers
    ShippingId shipmentId = createShipmentId();
    InvoiceId invoiceId = createInvoiceId();
    // associate the Saga with these values, before sending the commands
    associateWith("shipmentId", shipmentId);
    associateWith("invoiceId", invoiceId);
    // send the commands
    commandGateway.send(new PrepareShippingCommand(...));
    commandGateway.send(new CreateInvoiceCommand(...));
  }
  @SagaEventHandler(associationProperty = "shipmentId")
  public void handle(ShippingArrivedEvent event) {
    delivered = true;
    if (paid) { end(); }
  }
  @SagaEventHandler(associationProperty = "invoiceId")
  public void handle(InvoicePaidEvent event) {
    paid = true;
    if (delivered) { end(); }
  }
// ...
}
```
有时我们可能并不想直接使用Event里field的名称作为`associationProperty`的值，可以使用keyName来对应field名称。
Saga是靠Event驱动的，但有时command发出去了，并没有在规定时间内收到预期的Event怎么办？Saga提供了`EventScheduler`，通过Java内置的scheduler或Quarz，定时自动发送一个Event到这个Saga。
Saga的执行是在独立的线程里，所以我们无法通过commandgateway的sendAndWait方法等到其返回值或捕获异常。

### Saga Store
由于Sage在处理过程中也存在中间状态，而Saga的一些业务流程可能会执行很长时间，比如好几天，那么万一系统重启Saga的状态就丢失了，所以Saga也需要能够通过ES恢复，即指定一个`SagaStore`。
`SagaStore`与`EventStore`的使用除了名字外，基本没有任何区别，也内置了InMemory,JPA,jdbc,Mongo四种实现这里我就不多叙述了。
> 注意！当持久化Saga时，对于注入的资源field，如CommandGateway，一定要加上`transient`修饰符，这样Serializer才不会去序列化这个field。当Saga从Repository读出来的时候，会自动注入相关的资源。

只需要显示的提供一个`SagaStore`的配置就可以了。当启用JPA时，默认会启动`JpaSagaStore`。我们这里使用`MongoSagaStore`，修改`AxonConfiguration`如下：
```java
@Configuration
public class AxonConfiguration {

  .....
  @Bean
  public SagaStore sagaStore(){
      org.axonframework.mongo.eventhandling.saga.repository.MongoTemplate mongoTemplate =
              new org.axonframework.mongo.eventhandling.saga.repository.DefaultMongoTemplate(mongoClient(), mongoDbName, "sagas");
      return new MongoSagaStore(mongoTemplate, axonJsonSerializer());
  }
}
```
**在@StartSaga执行后，会把当前Saga插入到指定的SagaStore中，当@EndSaga执行时，axon会自动的从SagaStore中删除该Saga。**

## 修改Handler
由于`ReserveProductCommand`和`RollbackReservationCommand`是需要查找原ProductAggregate的，所以单独创建一个`ProductHandler`
`ProductHandler`
```java
@Component
public class ProductHandler {

    private static final Logger LOGGER = getLogger(ProductHandler.class);

    @Autowired
    private Repository<ProductAggregate> repository;

    @CommandHandler
    public void on(ReserveProductCommand command){
        Aggregate<ProductAggregate> aggregate = repository.load(command.getProductId());
        aggregate.execute(aggregateRoot->aggregateRoot.reserve(command.getOrderId(), command.getNumber()));
    }

    @CommandHandler
    public void on(RollbackReservationCommand command){
        Aggregate<ProductAggregate> aggregate = repository.load(command.getProductId());
        aggregate.execute(aggregateRoot->aggregateRoot.cancellReserve(command.getOrderId(), command.getNumber()));
    }
}
```
修改ProductAggregate，增加对应的方法和handler
`ProductAggregate`
```java
@Aggregate
public class ProductAggregate {
  public void reserve(OrderId orderId, int amount){
    if(stock>=amount) {
        apply(new ProductReservedEvent(orderId, id, amount));

    }else
        apply(new ProductNotEnoughEvent(orderId, id));
  }

  public void cancellReserve(OrderId orderId, int amount){
      apply(new ReserveCancelledEvent(orderId, id, stock));
  }

  @EventHandler
  public void on(ProductReservedEvent event){
      int oriStock = stock;
      stock = stock - event.getAmount();
      LOGGER.info("Product {} stock change {} -> {}", id, oriStock, stock);
  }

  @EventHandler
  public void on(ReserveCancelledEvent event){
      stock +=event.getAmount();
      LOGGER.info("Reservation rollback, product {} stock changed to {}", id, stock);
  }
}
```
Order这边对应也要修改Aggregate和handler
`OrderHandler`
```java
@Component
public class OrderHandler {
  @CommandHandler
  public void handle(RollbackOrderCommand command){
      Aggregate<OrderAggregate> aggregate = repository.load(command.getOrderId().getIdentifier());
      aggregate.execute(aggregateRoot->aggregateRoot.delete());
  }

  @CommandHandler
  public void handle(ConfirmOrderCommand command){
      Aggregate<OrderAggregate> aggregate = repository.load(command.getId().getIdentifier());
      aggregate.execute(aggregateRoot->aggregateRoot.confirm());
  }
}
```
`OrderAggregate`
```java
@Aggregate
public class OrderAggregate {
  private String state="processing"; // 增加一个属性订单状态
  ......

  @EventHandler
  public void on(OrderConfirmedEvent event){
      this.state = "confirmed";
  }

  @EventHandler
  public void on(OrderCancelledEvent event){
      this.state = "deleted";
      markDeleted();
  }
}
```
## 启动测试
其他地方基本没有什么改动，为方便起见，我把Query端也改成MongoDB了，方法比较简单，就引入`spring-boot-starter-data-mongodb`包，启动类里将`@EnableJpaRepositories`改成`@EnableMongoRepositories`，然后把Queyr端的Entry类包含在Scan的范围内就好了。
```java
@SpringBootApplication
@ComponentScan(basePackages = {"com.edi.learn"})
@EntityScan(basePackages = {"com.edi.learn",
        "org.axonframework.eventsourcing.eventstore.jpa",
        "org.axonframework.eventhandling.saga.repository.jpa",
        "org.axonframework.eventhandling.tokenstore.jpa"})
@EnableMongoRepositories(basePackages = {"com.edi.learn"})
public class Application {

    private static final Logger LOGGER = getLogger(Application.class);

    public static void main(String args[]){
        SpringApplication.run(Application.class, args);
    }
}
```
执行后，
1. POST请求到http://127.0.0.1:8080/product/1?name=ttt&price=10&stock=100 创建商品；
2. POST如下JSON到http://127.0.0.1:8080/order 来创建订单
```json
{
	"username":"Edison",
	"products":[{
		"id":1,
		"number":90
	}]
}
```
3. 再创建一次
可以看到控制台打印
```
09:39:10.648 [http-nio-8080-exec-1] DEBUG c.e.l.a.c.w.c.ProductController - Adding Product [1] 'ttt' 10x100
09:39:10.675 [http-nio-8080-exec-1] DEBUG c.e.l.a.c.a.ProductAggregate - Product [1] ttt 1000x100 is created.
09:39:10.853 [http-nio-8080-exec-1] DEBUG c.e.l.a.q.h.ProductEventHandler - repository data is updated
09:39:21.640 [http-nio-8080-exec-3] DEBUG c.e.l.a.c.a.ProductAggregate - Product [1] ttt 1000x100 is created.
09:39:21.681 [http-nio-8080-exec-3] INFO  c.e.l.a.c.a.ProductAggregate - Product 1 stock change 100 -> 10
09:39:21.823 [http-nio-8080-exec-3] INFO  c.e.l.axon.command.saga.OrderSaga - Order 8706dbaf-4511-4b01-b6c5-e24bec3f10a9 is confirmed
09:42:35.255 [http-nio-8080-exec-5] DEBUG c.e.l.a.c.handlers.OrderHandler - Loading product information with productId: 1
09:42:35.259 [http-nio-8080-exec-5] DEBUG c.e.l.a.c.a.ProductAggregate - Product [1] ttt 1000x100 is created.
09:42:35.263 [http-nio-8080-exec-5] INFO  c.e.l.a.c.a.ProductAggregate - Product 1 stock change 100 -> 10
09:42:35.301 [http-nio-8080-exec-5] INFO  c.e.l.axon.command.saga.OrderSaga - No enough item to buy
09:42:35.313 [http-nio-8080-exec-5] INFO  c.e.l.axon.command.saga.OrderSaga - Order 6baba5e9-1173-48a8-ab98-cd51691ba9f5 is cancelled
```
4. 重启程序，再创建一次订单后发送GET请求到http://127.0.0.1:8080/orders 查询订单
```json
{
  "_embedded": {
    "orders": [
      {
        "username": "Edison",
        "payment": 0,
        "status": "confirmed",
        "products": {
          "1": {
            "name": "ttt",
            "price": 1000,
            "amount": 90
          }
        },
        "_links": {
          "self": {
            "href": "http://localhost:8080/orders/8706dbaf-4511-4b01-b6c5-e24bec3f10a9"
          },
          "orderEntry": {
            "href": "http://localhost:8080/orders/8706dbaf-4511-4b01-b6c5-e24bec3f10a9"
          }
        }
      },
      {
        "username": "Edison",
        "payment": 0,
        "status": "cancelled",
        "products": {
          "1": {
            "name": "ttt",
            "price": 1000,
            "amount": 90
          }
        },
        "_links": {
          "self": {
            "href": "http://localhost:8080/orders/6baba5e9-1173-48a8-ab98-cd51691ba9f5"
          },
          "orderEntry": {
            "href": "http://localhost:8080/orders/6baba5e9-1173-48a8-ab98-cd51691ba9f5"
          }
        }
      },
      {
        "username": "Edison",
        "payment": 0,
        "status": "cancelled",
        "products": {
          "1": {
            "name": "ttt",
            "price": 1000,
            "amount": 90
          }
        },
        "_links": {
          "self": {
            "href": "http://localhost:8080/orders/27a829af-cda1-43f4-af37-fbc597fe5f6f"
          },
          "orderEntry": {
            "href": "http://localhost:8080/orders/27a829af-cda1-43f4-af37-fbc597fe5f6f"
          }
        }
      }
    ]
  },
  "_links": {
    "self": {
      "href": "http://localhost:8080/orders"
    },
    "profile": {
      "href": "http://localhost:8080/profile/orders"
    }
  },
  "page": {
    "size": 20,
    "totalElements": 3,
    "totalPages": 1,
    "number": 0
  }
}
```
很明显看到只有第一个订单状态为'confirmed'，其他两个都是'cancelled'。重启后，Aggregate自动回溯后，对库存的判断也是正确的。
5. 再做个小实验，我们修改`OrderSaga`，强制在确认订单时让线程sleep一段时间，然后去MongoDB里查看Saga信息
```java
@SagaEventHandler(associationProperty = "id", keyName = "orderId")
@EndSaga
public void handle(OrderConfirmedEvent event) throws InterruptedException {
    LOGGER.info("Order {} is confirmed", event.getId());
    Thread.sleep(10000);
}
```
```
> db.sagas.find().pretty()
{
        "_id" : ObjectId("58df074d73bc0c10f4008eff"),
        "sagaType" : "com.edi.learn.axon.command.saga.OrderSaga",
        "sagaIdentifier" : "08a371f5-9d9a-48a7-b46e-9b8e86b8897b",
        "serializedSaga" : BinData(0,"e30="),
        "associations" : [
                {
                        "key" : "orderId",
                        "value" : "5111a55e-1ddd-4434-aab8-635c004fc1eb"
                }
        ]
}
```
看到我们的关联值了吧。

本文代码：https://github.com/EdisonXu/sbs-axon/tree/master/lesson-5
