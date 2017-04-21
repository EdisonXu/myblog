---
title: CQRS和Event Souring系列（八）：DistributeCommand和DistributeEvent
date: 2017-04-01 15:01:51
tags:
- CQRS
- axon
- DDD
- eventsourcing
---
> 上一篇我们才算真正实现了一个基于Axon3的例子，本篇我们来尝试实现在分布式环境下利用Axon3做CQRS，即把CommandSide和QuerySide变成两个独立应用，分别可以启多份实例。

首先，我们回顾一下CQRS&EventSourcing模式下，整个架构的关键点，或者说最大的特点：
- CommandSide和QuerySide的持久层分离；
- 保存对Aggregate状态造成变化的Event，而不是状态本身；
- Aggregate的状态全局原子化操作；
- 适用于读大于写的场景；
我们前面的例子，是在一个应用里面实现了CQRS模式，而在分布式场景下，有如下要求：
- CommandSide和QuerySide可以不在同一个节点(甚至不在同一个应用)下；
- CommandSide不同的CommandHandler、EventHandler可以不在同一个节点；
- 不同CommandSide对同一个Aggregate的操作应具有原子性；
我们来一步步满足这三个要求。

## 拆分CommandSide和QuerySide
这个其实比较好解决，直接把两者分别用两个SpringBoot来承载就好了，只需要引入一个MQ，传递从CommandSide到QuerySide的事件就好了。
Axon提供了对AMQP协议的MQ的支持，我们可以直接拿来用。当然，你也可以用Kafka等其他MQ，只是需要自己实现了。
具体关于Axon对AMQP的支持，在后面会详述。

## 实现CommandHandler的分布式调用
前文中提到过，Axon提供的四种CommandBus的实现中，有一个`DistributedCommandBus`，`DistributedCommandBus`不会直接调用command handler，它只是在不同JVM的commandbus之间建立一个“桥梁”。每个JVM上的`DistributedCommandBus`被称为“Segment”。
![](/images/2017/03/distributed-command-bus.png)
`DistributedCommandBus`要求提供两个参数:
1. `CommandRouter`提供路由表，指明应当把Command发到哪里。`CommandRouter`的实现必须提供Routing Strategy，以此来计算Routing Key。Axon提供了两种Routing Strategy：
  - MetaDataRoutingStrategy 使用CommandMessage中的MetaData的property来找到路由key
  - AnnotationRoutingStrategy（默认） 使用Command中@TargetIdentifier标识的field做路由key
  **所以，当使用`DistributeCommandBus`时，如果使用默认的Routing Strategy，一定要在Command中提供@TargetIdentifier**
2. `CommandBusConnector`管理链接，提供发送、订阅方法
Axon目前提供了两种Connector的实现：JGroupsConnector和SpringCloudConnector。本文将使用JGroup，后者将放到后一篇与SpringCloud集成一文中使用。
起用JGroupsConnector很简单，只需要确保如下两个依赖存在：
```xml
<dependency>
    <groupId>org.axonframework</groupId>
    <artifactId>axon-spring-boot-starter-jgroups</artifactId>
    <version>${axon.version}</version>
</dependency>
<dependency>
    <groupId>org.axonframework</groupId>
    <artifactId>axon-spring-boot-autoconfigure</artifactId>
    <version>${axon.version}</version>
</dependency>
```
axon-spring-boot-autoconfigure提供了自动配置，在`AxonAutoConfiguration`类中，可以发现有如下源码
```java
@ConditionalOnClass(name = {"org.axonframework.jgroups.commandhandling.JGroupsConnector", "org.jgroups.JChannel"})
@EnableConfigurationProperties(JGroupsConfiguration.JGroupsProperties.class)
@ConditionalOnProperty("axon.distributed.jgroups.enabled")
@AutoConfigureAfter(JpaConfiguration.class)
@Configuration
public static class JGroupsConfiguration {

    private static final Logger logger = LoggerFactory.getLogger(JGroupsConfiguration.class);
    @Autowired
    private JGroupsProperties jGroupsProperties;

    @ConditionalOnProperty("axon.distributed.jgroups.gossip.autoStart")
    @Bean(destroyMethod = "stop")
    public GossipRouter gossipRouter() {
        Matcher matcher =
                Pattern.compile("([^[\\[]]*)\\[(\\d*)\\]").matcher(jGroupsProperties.getGossip().getHosts());
        if (matcher.find()) {

            GossipRouter gossipRouter = new GossipRouter(matcher.group(1), Integer.parseInt(matcher.group(2)));
            try {
                gossipRouter.start();
            } catch (Exception e) {
                logger.warn("Unable to autostart start embedded Gossip server: {}", e.getMessage());
            }
            return gossipRouter;
        } else {
            logger.error("Wrong hosts pattern, cannot start embedded Gossip Router: " +
                                 jGroupsProperties.getGossip().getHosts());
        }
        return null;
    }

    @ConditionalOnMissingBean
    @Primary
    @Bean
    public DistributedCommandBus distributedCommandBus(CommandRouter router, CommandBusConnector connector) {
        DistributedCommandBus commandBus = new DistributedCommandBus(router, connector);
        commandBus.updateLoadFactor(jGroupsProperties.getLoadFactor());
        return commandBus;
    }

    @ConditionalOnMissingBean({CommandRouter.class, CommandBusConnector.class})
    @Bean
    public JGroupsConnectorFactoryBean jgroupsConnectorFactoryBean(Serializer serializer,
                                                                   @Qualifier("localSegment") CommandBus
                                                                           localSegment) {

        System.setProperty("jgroups.tunnel.gossip_router_hosts", jGroupsProperties.getGossip().getHosts());
        System.setProperty("jgroups.bind_addr", String.valueOf(jGroupsProperties.getBindAddr()));
        System.setProperty("jgroups.bind_port", String.valueOf(jGroupsProperties.getBindPort()));

        JGroupsConnectorFactoryBean jGroupsConnectorFactoryBean = new JGroupsConnectorFactoryBean();
        jGroupsConnectorFactoryBean.setClusterName(jGroupsProperties.getClusterName());
        jGroupsConnectorFactoryBean.setLocalSegment(localSegment);
        jGroupsConnectorFactoryBean.setSerializer(serializer);
        jGroupsConnectorFactoryBean.setConfiguration(jGroupsProperties.getConfigurationFile());
        return jGroupsConnectorFactoryBean;
    }

    @ConfigurationProperties(prefix = "axon.distributed.jgroups")
    public static class JGroupsProperties {

        private Gossip gossip;

        /**
         * Enables JGroups configuration for this application
         */
        private boolean enabled = false;

        /**
         * The name of the JGroups cluster to connect to. Defaults to "Axon".
         */
        private String clusterName = "Axon";

        /**
         * The JGroups configuration file to use. Defaults to a TCP Gossip based configuration
         */
        private String configurationFile = "default_tcp_gossip.xml";

        /**
         * The address of the network interface to bind JGroups to. Defaults to a global IP address of this node.
         */
        private String bindAddr = "GLOBAL";

        /**
         * Sets the initial port to bind the JGroups connection to. If this port is taken, JGroups will find the
         * next available port.
         */
        private String bindPort = "7800";

        /**
         * Sets the loadFactor for this node to join with. The loadFactor sets the relative load this node will
         * receive compared to other nodes in the cluster. Defaults to 100.
         */
        private int loadFactor = 100;

        public Gossip getGossip() {
            return gossip;
        }

        public void setGossip(Gossip gossip) {
            this.gossip = gossip;
        }

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public String getClusterName() {
            return clusterName;
        }

        public void setClusterName(String clusterName) {
            this.clusterName = clusterName;
        }

        public String getConfigurationFile() {
            return configurationFile;
        }

        public void setConfigurationFile(String configurationFile) {
            this.configurationFile = configurationFile;
        }

        public String getBindAddr() {
            return bindAddr;
        }

        public void setBindAddr(String bindAddr) {
            this.bindAddr = bindAddr;
        }

        public String getBindPort() {
            return bindPort;
        }

        public void setBindPort(String bindPort) {
            this.bindPort = bindPort;
        }

        public int getLoadFactor() {
            return loadFactor;
        }

        public void setLoadFactor(int loadFactor) {
            this.loadFactor = loadFactor;
        }

        public static class Gossip {

            /**
             * Whether to automatically attempt to start a Gossip Routers. The host and port of the Gossip server
             * are taken from the first define host in 'hosts'.
             */
            private boolean autoStart = false;

            /**
             * Defines the hosts of the Gossip Routers to connect to, in the form of host[port],...
             * <p>
             * If autoStart is set to {@code true}, the first host and port are used as bind address and bind port
             * of the Gossip server to start.
             * <p>
             * Defaults to localhost[12001].
             */
            private String hosts = "localhost[12001]";

            public boolean isAutoStart() {
                return autoStart;
            }

            public void setAutoStart(boolean autoStart) {
                this.autoStart = autoStart;
            }

            public String getHosts() {
                return hosts;
            }

            public void setHosts(String hosts) {
                this.hosts = hosts;
            }
        }
    }
}
```
可以看到我们只需在application.properties中添加
```
axon.distributed.jgroups.enabled=true
axon.distributed.jgroups.gossip.autoStart=true
```
就可以启用JGroupsConnector。同时也可以用前缀axon.distributed.jgroups加上`JGroupsProperties`里定义的各种field名来做JGroup的配置。（默认连接本地7800端口）
这里值得注意的是：
1. `JGroupsConnectorFactoryBean`实现的方法中，有一段_System.setProperty("jgroups.tunnel.gossiprouterhosts", jGroupsProperties.getGossip().getHosts());_ ，如果axon.distributed.jgroups.gossip.autoStart未设为true(默认false)，那么getGossip()显然将会报空指针异常。
2. `JacksonSerializer`的实现中，并未去考虑Jackson对Exception的处理(**objectMapper.configure( DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)**)，导致一旦在Command执行时发生异常，DistributeCommandBus也会尝试把这个Exception消息进行序列化，而Jackson默认是无法处理java.lang.Throwable类的，就会发生序列化错误_org.codehaus.jackson.map.exc.UnrecognizedPropertyException: Unrecognized field "cause" (Class java.lang.Throwable), not marked as ignorable_，从而导致把真正的Exception给掩埋掉了。所以，这里我就改回默认的XStreamSerializer。
3. 默认情况下，`localSegment`是SimpleCommandBus，所以参考前文，可以使用sendAndWait把异常抛到最前端处理，或者用send(command, callback)传入一个callback，在callback的onFailure方法对Throwable进行处理。

## 实现EventHandler的分布式调用
通常情况下，Event的分发我们第一时间想到的就是MQ，Axon也不例外，提供了对[AMQP](https://en.wikipedia.org/wiki/Advanced_Message_Queuing_Protocol)(Advanced Message Queuing Protocol)的支持，例如Rabbit MQ。
引入如下Maven依赖：
```xml
<dependency>
    <groupId>org.axonframework</groupId>
    <artifactId>axon-amqp</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-amqp</artifactId>
</dependency>
<dependency>
    <groupId>org.axonframework</groupId>
    <artifactId>axon-spring-boot-autoconfigure</artifactId>
</dependency>
```
spring-boot-starter-amqp提供具体AMQP实现的服务，axon-amqp提供具体的Event分发机制实现，axon-spring-boot-autoconfigure提供AMQP的自动配置。
AxonAutoConfiguration中，关于AMQP部分的源码如下：
```java
@ConditionalOnClass({SpringAMQPPublisher.class, ConnectionFactory.class})
@EnableConfigurationProperties(AMQPProperties.class)
@Configuration
public static class AMQPConfiguration {

    @Autowired
    private AMQPProperties amqpProperties;

    @ConditionalOnMissingBean
    @Bean
    public RoutingKeyResolver routingKeyResolver() {
        return new PackageRoutingKeyResolver();
    }

    @ConditionalOnMissingBean
    @Bean
    public AMQPMessageConverter amqpMessageConverter(Serializer serializer, RoutingKeyResolver routingKeyResolver) {
        return new DefaultAMQPMessageConverter(serializer, routingKeyResolver, amqpProperties.isDurableMessages());
    }

    @ConditionalOnProperty("axon.amqp.exchange")
    @Bean(initMethod = "start", destroyMethod = "shutDown")
    public SpringAMQPPublisher amqpBridge(EventBus eventBus, ConnectionFactory connectionFactory,
                                          AMQPMessageConverter amqpMessageConverter) {
        SpringAMQPPublisher publisher = new SpringAMQPPublisher(eventBus);
        publisher.setExchangeName(amqpProperties.getExchange());
        publisher.setConnectionFactory(connectionFactory);
        publisher.setMessageConverter(amqpMessageConverter);
        switch (amqpProperties.getTransactionMode()) {

            case TRANSACTIONAL:
                publisher.setTransactional(true);
                break;
            case PUBLISHER_ACK:
                publisher.setWaitForPublisherAck(true);
                break;
            case NONE:
                break;
            default:
                throw new IllegalStateException("Unknown transaction mode: " + amqpProperties.getTransactionMode());
        }
        return publisher;
    }
}
```
可以看到，只要引入了Spring关于AMQP的starter包，我们只需要在application.properties中用`axon.amqp.exchange=Axon.EventBus`指明AMQP的exchange名字就可以启用了，非常方便。
另外就是需要给spring-boot-starter-amqp提供amqp具体实现的配置，这里我们以[RabbitMq](https://www.rabbitmq.com/)为例：
```properties
# mq
spring.rabbitmq.host=10.1.110.21
spring.rabbitmq.port=5672
spring.rabbitmq.username=axon
spring.rabbitmq.password=axon
axon.amqp.exchange=Axon.EventBus
```
RabbitMqServer的搭建我这里就不叙述了，网上一搜一大把。但为了方便理解，我还是简单介绍下AMQP和RabbitMq的一些关键要素。
首先看一下AMQP的"生产/消费"模型图
![](/images/2017/04/producer_consumer.png)
我们关注里面的三个核心概念
- `Exchange`: 交换器，message到达broker的第一站，根据分发策略，匹配查询表中的routing key，分发消息到queue中去。
- `Queue`：消息最终被送到这里等待consumer取走。一个message可以被同时拷贝到多个queue中。
- `Binding`：Exchange与Queue之间的绑定关系，指定了绑定策略，即消息的分发策略。
分发策略有以下四种：
- `direct`
  ![](/images/2017/04/direct_exchange.png)
  "先匹配, 再投送". 即在绑定时设定一个`routing_key`, 消息的`routing_key`匹配时, 才会被交换器投送到绑定的队列中去.
- `fanout`
  ![](/images/2017/04/fanout_exchange.png)
  把消息转发给所有绑定的队列上, 就是一个"广播"行为.
- `topic`
  ![](/images/2017/04/topic_exchange.png)
  与direct类似，只是绑定的`routing_key`支持匹配规则（并不是正则！），会把消息自己的`routing_key`与绑定的`routing_key`进行匹配操作，只把匹配成功的发到对应queue中。
  这里有个“坑”，rabbit提供的*绑定一个任意字母，#绑定0个或多个字母匹配规则中，#并不能直接使用，比如#test#就无法匹配aatest33，必须要#.test.#才起作用，匹配aa.test.33，也是醉了。所以Axon默认提供的RoutingKey生成就是根据包名来匹配……
- `headers`
  不使用`routing_key`，而使用`headers`来做匹配。

那么我们来对AMQP在代码中做exchange和queue的绑定，以及对event的listen动作。
`AMQPConfiguration`
```java
@Configuration
public class AMQPConfiguration {

  @Value("${axon.amqp.exchange}")
  private String exchangeName;

  @Bean
  public Queue productQueue(){
      return new Queue("product", true);
  }

  @Bean
  public Queue orderQueue(){
      return new Queue("order",true);
  }

  @Bean
  public Exchange exchange(){
      return ExchangeBuilder.topicExchange(exchangeName).durable(true).build();
  }

  @Bean
  public Binding productQueueBinding() {
      return BindingBuilder.bind(productQueue()).to(exchange()).with("#.product.#").noargs();
  }

  @Bean
  public Binding orderQueueBinding() {
      return BindingBuilder.bind(orderQueue()).to(exchange()).with("#.order.#").noargs();
  }

  /*@Bean
  public SpringAMQPMessageSource productQueueMessageSource(Serializer serializer){
      return new SpringAMQPMessageSource(serializer){
          @RabbitListener(queues = "product")
          @Override
          public void onMessage(Message message, Channel channel) throws Exception {
              LOGGER.debug("Product message received: "+message.toString());
              super.onMessage(message, channel);
          }
      };
  }

  @Bean
  public SpringAMQPMessageSource orderQueueMessageSource(Serializer serializer){
      return new SpringAMQPMessageSource(serializer){
          @RabbitListener(queues = "order")
          @Override
          public void onMessage(Message message, Channel channel) throws Exception {
              LOGGER.debug("Order message received: "+message.toString());
              super.onMessage(message, channel);
          }
      };
  }*/
}
```
注意，由于本例中，我并没有把Product和Order相关的Service拆分成两个应用，仍然在一个CommandSide中，所以其实我们根本用不到分布式EventHandler，local可以完成的操作，放到其他node去做，反而降低了性能。
所以，我这里并没有在CommandSide的这个`AMQPConfiguration`中去配置监听queue。这里的队列其实是CommandSide和QuerySide之间用的。
但配置和原理都是一样的，如果把Product和Order分开，`ProductReservedEvent`在ProductServcices所在节点扔到队列后，可按需配置绑定，让OrderService能够取到该事件，交给Saga中的EventHandler去处理。
在后面与SpringCloud集成的一文中，就会这样做。
QuerySide的`AMQPConfiguration`与上面一致，但是要打开被注释掉的部分。因为exchange和queue是自动创建的，有可能QuerySide先启动，所以必须要在QuerySide也加上exchange和queue的定义及绑定策略。
`@RabbitListener(queues = "product")`用来指定当前AMQPMessageSource要监听哪个queue。
同时，还需要修改application.properties，来绑定AMQPMessageSource和具体的EventHandler注册类
```property
axon.eventhandling.processors.product.source=productQueueMessageSource
axon.eventhandling.processors.order.source=orderQueueMessageSource
```
axon.eventhandling.processors.[processors_group_name].source中，前面axon.eventhandling.processors.[processors_group_name]其实是一个ProcessingGroup，Axon提供了注解@ProcessingGroup("[processors_group_name]")来进行标识。
所以我们需要在QuerySide的`ProductEventHandler`和`OrderEventHandler`上面增加该注解
```java
@Component
@ProcessingGroup("order")
public class OrderEventHandler{}

@Component
@ProcessingGroup("product")
public class ProductEventHandler {}
```

## 测试
为方便测试，我们来增加一个对Product库存进行调整的接口，这样可以启动两个CommandSide，同时对库存进行调整，看看会不会有并发问题。
同样，先定义Commmand和对应的Event：
ChangeStockCommand(productId, number)
IncreaseStockCommand extends ChangeStockCommand
DecreaseStockCommand extends ChangeStockCommand
IncreaseStockEvent(productId, number)
DecreaseStockEvent(productId, number)

修改`ProductAggregate`，增加对应的CommandHandler和EventHandler
```java
@Aggregate
public class ProductAggregate {
  ......

  @CommandHandler
  public void handle(IncreaseStockCommand command) {
      apply(new IncreaseStockEvent(command.getId(),command.getNumber()));
  }

  @CommandHandler
  public void handle(DecreaseStockCommand command) {
    if(stock>=command.getNumber())
          apply(new DecreaseStockEvent(command.getId(),command.getNumber()));
      else
          throw new NoEnoughStockException("No enough items");
  }

  @EventHandler
  public void on(IncreaseStockEvent event){
      stock = stock + event.getNumber();
      LOGGER.info("Product {} stock increase {}, current value: {}", id, event.getNumber(), stock);
  }

  @EventHandler
  public void on(DecreaseStockEvent event){
      stock = stock - event.getNumber();
      LOGGER.info("Product {} stock decrease {}, current value: {}", id, event.getNumber(), stock);
  }
}
```
最后对外增加一个REST接口：
```java
@RestController
@RequestMapping("/product")
public class ProductController {
  ......
  @PutMapping("/{id}")
  public void change(@PathVariable(value = "id") String id,
                     @RequestBody(required = true) JSONObject input,
                     HttpServletResponse response){
      boolean isIncrement = input.getBooleanValue("incremental");
      int number = input.getIntValue("number");
      ChangeStockCommand command = isIncrement? new IncreaseStockCommand(id, number) : new DecreaseStockCommand(id, number);

      try {
          // multiply 100 on the price to avoid float number
          //commandGateway.send(command, LoggingCallback.INSTANCE);
          commandGateway.sendAndWait(command);
          response.setStatus(HttpServletResponse.SC_OK);// Set up the 201 CREATED response
          return;
      } catch (CommandExecutionException cex) {
          LOGGER.warn("Add Command FAILED with Message: {}", cex.getMessage());
          response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
          if (null != cex.getCause()) {
              LOGGER.warn("Caused by: {} {}", cex.getCause().getClass().getName(), cex.getCause().getMessage());
              if (cex.getCause() instanceof ConcurrencyException) {
                  LOGGER.warn("Concurrent issue happens for product {}", id);
                  response.setStatus(HttpServletResponse.SC_CONFLICT);
              }
          }
      } catch (Exception e) {
          // should not happen
          LOGGER.error("Unexpected exception is thrown", e);
          response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
      }
  }
}
```
这里我用了sendAndWait，把Exception一路抛上来在Controller捕获。你也可以用我注掉的那段send(command,callback)，传入一个callback，在callback的onFailure方法去处理。
同样，QuerySide要对这两个事件进行处理
`ProductEventHandler`
```java

```
好，最后我们把CommandSide的server.port配成0（随机端口），启动两个CommandSide(假定一个端口为<first_port>，一个为<second_port>)和一个QuerySide。
1. POST请求到http://127.0.0.1:<first_port>/product/1?name=ttt&price=10&stock=100 创建商品；
2. POST请求到http://127.0.0.1:<second_port>/product/1?name=ttt&price=10&stock=100 会发现报错，商品已存在；
2. GET请求到http://127.0.0.1:8080/product/1 在QuerySide查看商品是否创建成功；
3. PUT如下json到http://127.0.0.1:<first_port>/product/1 来增加库存；
```json
{
	"incremental":true,
	"number":10
}
```
4. PUT如下json到http://127.0.0.1:<second_port>/product/1 来减少库存；
```json
{
	"incremental":false,
	"number":101
}
```
5. 重置MongoDB的库，同时发送3、4，看看结果。
其实我们如果去MongoDB的Events里面查看，数据如下：
```json
> db.events.find().pretty()
{
        "_id" : ObjectId("58ec4ef673bc0c1c188117b9"),
        "aggregateIdentifier" : "1",
        "type" : "ProductAggregate",
        "sequenceNumber" : NumberLong(0),
        "serializedPayload" : "<com.edi.learn.axon.events.product.ProductCreatedEvent><id>1</id><name>ttt</name><price>1000</price><stock>100</stock></com.edi.learn.axon.events.product.ProductCreatedEvent>",
        "timestamp" : "2017-04-11T03:35:18.310Z",
        "payloadType" : "com.edi.learn.axon.events.product.ProductCreatedEvent",
        "payloadRevision" : null,
        "serializedMetaData" : "<meta-data><entry><string>traceId</string><string>af292c24-bde4-4ba1-a190-9743822f839c</string></entry><entry><string>correlationId</string><string>af292c24-bde4-4ba1-a190-9743822f839c</string></entry></meta-data>",
        "eventIdentifier" : "ed244ef3-a1fe-48fb-99b8-39ebd2444cc1"
}
{
        "_id" : ObjectId("58ec4f0273bc0c1c188117ba"),
        "aggregateIdentifier" : "1",
        "type" : "ProductAggregate",
        "sequenceNumber" : NumberLong(1),
        "serializedPayload" : "<com.edi.learn.axon.events.product.IncreaseStockEvent><id>1</id><number>10</number></com.edi.learn.axon.events.product.IncreaseStockEvent>",
        "timestamp" : "2017-04-11T03:35:30.728Z",
        "payloadType" : "com.edi.learn.axon.events.product.IncreaseStockEvent",
        "payloadRevision" : null,
        "serializedMetaData" : "<meta-data><entry><string>traceId</string><string>05252e0c-eb0b-4ed0-945c-0134fa94b6ba</string></entry><entry><string>correlationId</string><string>05252e0c-eb0b-4ed0-945c-0134fa94b6ba</string></entry></meta-data>",
        "eventIdentifier" : "f6b9786d-4abd-4407-a40b-880f88738b4b"
}
{
        "_id" : ObjectId("58ec4f0d73bc0c1ad83281d6"),
        "aggregateIdentifier" : "1",
        "type" : "ProductAggregate",
        "sequenceNumber" : NumberLong(2),
        "serializedPayload" : "<com.edi.learn.axon.events.product.DecreaseStockEvent><id>1</id><number>101</number></com.edi.learn.axon.events.product.DecreaseStockEvent>",
        "timestamp" : "2017-04-11T03:35:41.474Z",
        "payloadType" : "com.edi.learn.axon.events.product.DecreaseStockEvent",
        "payloadRevision" : null,
        "serializedMetaData" : "<meta-data><entry><string>traceId</string><string>cf21b4a8-dfae-4da8-a6e0-964876c101c3</string></entry><entry><string>correlationId</string><string>cf21b4a8-dfae-4da8-a6e0-964876c101c3</string></entry></meta-data>",
        "eventIdentifier" : "ac9db091-73fd-4830-9ddb-85fea3a13206"
}
```
其实可以发现`sequenceNumber`一值是递增的，说明Event在分布式环境中也是严格按时间排序的。这样即便是在两个不同的CommandSide节点，当我们尝试去改变Aggregate的状态时，Axon会做ES来从Repository里获取当前Aggregate的最新状态，从而实现了原子性操作。

本文完整代码：https://github.com/EdisonXu/sbs-axon/tree/master/lesson-6
