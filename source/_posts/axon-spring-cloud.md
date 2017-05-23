---
title: CQRS和Event Sourcing系列（九）：AxonFramework与SpringCloud的整合
date: 2017-04-24 15:01:51
tags:
- CQRS
- axon
- DDD
- eventsourcing
---
> 上一篇里，我们在利用Axon3的DistributeCommand的JGroup支持，和DistributedEvent对AMQP的支持，实现了分布式环境下的CQRS和EventSourcing。
> 在这一篇中，我们将把Axon3与当下比较火热的微服务框架——SpringCloud进行整合，并将其微服务化。

###### 写在前面的话
AxonFramework对SpringCloud的支持，是从3.0.2才开始的，但是在3.0.2和3.0.3两个版本，均存在blocking bug，**所以要想与SpringCloud完成整合，版本必须大于等于3.0.4**。
PS：连续跳坑，debug读代码，帮Axon找BUG，血泪换来的结论……好在社区足够活跃，作者也比较给力，连续更新。


## 设计
按照微服务的概念，我们把Product和Order各自相关的功能单独抽出来各做出一个服务，即product-service和order-service。与上一篇不同，这里并没有把各自service的command端和query端单独拆成一个service，而是放在一起了。当然，你也可以自行把他们拆开，中间通过mq传递消息。
具体架构如下：
![](/images/2017/04/lesson7_archi.png)

## 前置工作
首先，我们在父pom中配置好与SpringCloud集成相关的公共Maven依赖。
- 对SpringBoot的依赖 (这一块前面我们已经配置过了，这里可以跳过)
- 对SpringCloud的依赖
- 对具体SpringCloud组件的依赖

```xml
<modules>
    <module>common-api</module>
    <module>config-service</module>
    <module>discovery-service</module>
    <module>proxy-service</module>
    <module>product-service</module>
    <module>order-service</module>
</modules>

<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.springframework.cloud</groupId>
            <artifactId>spring-cloud-dependencies</artifactId>
            <version>Camden.SR6</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>

<dependencies>
    <!-- Spring Cloud Features -->
    <dependency>
        <groupId>org.springframework.cloud</groupId>
        <artifactId>spring-cloud-starter-eureka</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.cloud</groupId>
        <artifactId>spring-cloud-starter-config</artifactId>
    </dependency>
</dependencies>
```

## SpringCloud组件
熟悉SpringCloud的朋友，可以直接跳过本章。
### Discovery Serivce
使用SpringCloud中的Eureka组件，实现服务注册和发现。各个服务本身把自己注册到Eureka上，Proxy Service使用的zuul，在配置了Eureka相关信息后，会自动从Eureka中发现对应服务名及其地址，与配置文件中进行匹配，从而实现动态路由。
同时Eureka提供的UI也可以很直观的对服务当前的状态进行监控。
使用Eureka非常简单，引入Maven依赖
```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-eureka-server</artifactId>
</dependency>
```
然后在SpringBootApplication的类申明上加上`@EnableEurekaServer`注解即可。
对应配置文件如下：
```yml
# Configure this Discovery Server
eureka:
  instance:
    hostname: localhost
    lease-expiration-duration-in-seconds: 5
    lease-renewal-interval-in-seconds: 5
  client: #Not a client, don't register with yourself
    registerWithEureka: false
    fetchRegistry: false
    healthcheck:
      enabled: true
  server:
      enable-self-preservation: false

endpoints:
 shutdown:
  enabled: true

server:
  port: 1111 #HTTP(Tomcat) port
```
没什么花样，只是申明自己不是EurekaClient，而是Server。
Eureka有一个自我保护机制关闭，默认打开的情况下，当注册的service"挂掉"后，Eureka短时间内并不会直接把它从列表内清除，而是保留一段时间。因为Eureka的设计者认为分布式环境中网络是不可靠的，也许因为网络的原因，Eureka Server没有收到实例的心跳，但并不说命实例就完蛋了，所以这种机制下，它仍然鼓励客户端再去尝试调用这个所谓DOWN状态的实例，如果确实调用失败了，断路器机制还可以派上用场。这里我们方便起见，直接使用server.enable-self-preservation设置为false关闭掉它。（生产别这么用）

### Proxy Service
使用SpringCloud中的zuul组件。具体作用有：
- 全局网关，屏蔽内部系统和网络
- 请求拦截和动态路由
- 请求负载均衡
zuul的使用配置非常简单，引入Maven依赖
```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-zuul</artifactId>
</dependency>
```
然后在SpringBootApplication类申明上加上`@EnableZuulProxy`和`@EnableDiscoveryClient`注解即可。`@EnableDiscoveryClient`是把Proxy Service注册到Eureka上。
对应配置文件如下：
```yml
spring:
  application:
    name: proxy-service

  cloud:
    config:
      discovery.enabled: true
      discovery.serviceId: config-service
      failFast: false

# Discovery Server Access
eureka:
  client:
    serviceUrl:
      defaultZone: http://${config.host:10.1.110.21}:1111/eureka/

zuul:
  ignoredServices: '*'
  routes:
    product_command_path:
      path: /product/**
      stripPrefix: false
      serviceId: product-service
    product_query_path:
      path: /products/**
      stripPrefix: false
      serviceId: product-service
    order-command_path:
      serviceId: order-service
      path: /order/**
      stripPrefix: false
    order_query_path:
      serviceId: order-service
      path: /orders/**
      stripPrefix: false
```
`spring.application.name` 属性指定服务名
`spring.cloud.config` 相关的是配置ConfigService去Eureka上找serviceId为`config-service`的服务
`eureka.client.serviceUrl.defaultZone` 配置要注册的Eureka的地址
`ignoredServices`设为*，即不转发除了下面`routes`以外的所有请求
`routes.<xxx>.path` 是映射xxx服务与URL地址
`routes.<xxx>.stripPrefix` 是不使用前缀，即将http://product/* 请求直接转发到product-service。如果设置了前缀，那么合法路径则变为http://<prefix>/product/* 。
`routes.<xxx>.serviceId` 即Eureka上xxx服务所注册的服务名，zuul从Eureka上找到该服务名所对应的服务器信息，从而实现动态路由。
这里为了演示zuul对不同路径映射到相同服务，我故意把command和query端的URL地址设为不同，如/product和/products。

### Cloud Configs Service
使用SpringCloud中的Cloud组件，实现统一文件配置。（未引入SpringCloudBus实现配置修改通知，可自行修改添加。）
一样，引入Maven依赖
```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-config-server</artifactId>
</dependency>
```
在SpringBootApplication的类声明前加上`@EnableConfigServer`和`@EnableDiscoveryClient`注解。`@EnableDiscoveryClient`是把Config Service注册到Eureka上。
SpringCloudConfig最大的好处，可以从git读取配置，给不同环境、不同zone设置不同分支，根据profile指定分支，非常方便。
在这里为了方便各位自己跑，我把Config Service配置为读取本地文件。
```yml
server:
  port: 1000

spring:
  # Active reading config from local file system
  profiles:
    active: native

  application:
    name: config-service

  cloud:
    config:
      server:
        native:
          searchLocations: /usr/edi/spring/configs

management:
  context-path: /admin

eureka:
  client:
    serviceUrl:
      defaultZone: http://localhost:1111/eureka/
```

## 业务服务
在前一篇[CQRS和Event Souring系列（八）：DistributeCommand和DistributeEvent](http://edisonxu.org/2017/04/01/axon-distribute.html) 中提到过，DistributedCommandBus不会直接调用command handler，它只是在不同JVM的commandbus之间建立一个“桥梁”，通过指定`CommandRouter`和`CommandBusConnector`进行Command的分发。`axon-distributed-commandbus-springcloud`包提供了SpringCloud环境下的`CommandRouter`和`CommandBusConnector`。
**_CommandRouter_**
`SpringCloudCommandRouter`是该包中`CommandRouter`的具体实现类，其实是调用了我们在SpringBootApplication中`@EnableDiscoveryClient`后注入的EurekaClient。
每一个Axon的command节点在启动时，会通过DiscoveryClient把本地所有的CommandHandler变向的塞入本地服务在Eureka上的metadata信息中。当DistributedCommandBus发送command时，通过DiscoveryClient从Eureka上获取所有节点信息后，找到metadata中的CommandHandler的信息进行command匹配，分发到匹配的节点去处理command。

**_CommandBusConnector_**
`SpringHttpCommandBusConnector`是`CommandBusConnector`的具体实现类，它其实在本地起了一个地址为"/spring-command-bus-connector"的REST接口，用以接受来自其他节点的command请求。
同时，它也覆写了方法`CommandBusConnector`中的send方法，用以发送command到经`CommandRouter`确认的目标地址。当然，它会先判断目标地址是否本地，如果是本地，则直接调用localCommandBus去处理了，否则，则使用RestTemplate将Command发送到远程地址。

所以，启用Axon对SpringCloud的支持，必须要有三步（引入`axon-spring-boot-autoconfigure`的前提下）：
1. 引入`axon-distributed-commandbus-springcloud`包依赖；
2. 配置文件中`axon.distributed.enabled`设置为true;
3. 在自己的配置类中提供一个名字为`restTemplate`的Bean，返回一个RestTemplate的对象；

**注意！**
目前不能在RestTemplate声明时加上@LoadBalance启用Ribbon做负载均衡，因为`SpringHttpCommandBusConnector`在发送远程command时，会根据Eureka返回的目标Server信息自己build URI，URI中直接使用了ip/hostname，而不是service name。一旦用@LoadBalance，那么请求将被拦截生成RibbonHttpRequest,该Request在执行时会把传入的URI当做service name去与DiscoveryClient取到的所有service的service name匹配，最终会找不到目标节点，而报java.lang.IllegalStateException: No instances available for 10.1.110.21 。 这里10.1.110.21即是前面`SpringHttpCommandBusConnector`自己从DiscoveryClient那已经解析出来的ip。

### Product Serivce
核心代码与上一篇并无大区别，依然是CQRS，C端采用JPA将Event持久化到Mysql，而Q端将数据保存在MongoDB，方便查询（好吧，这仅仅是为了show一下怎么样在C、Q端使用不同的持久层而已，存Event的话，MongoDB比MySql适合的多）。这里只把不同地方中关键的列出来说一下，详细请查阅代码。
_**pom依赖**_
引入`axon-distributed-commandbus-springcloud`包依赖
```xml
<dependency>
    <groupId>org.axonframework</groupId>
    <artifactId>axon-distributed-commandbus-springcloud</artifactId>
    <version>${axon.version}</version>
</dependency>
```
`AMQPConfiguration`
配置AMQP协议的mq绑定，用于把Event分发到mq中，最终由Order Service的OrderSaga去处理。Product Serivce本身不消费Order Service所产生的Event，本地的EventHandle并不会走MQ。详细配置这里就省略了，可以参见上一篇文章或者看具体代码。

`CloudConfiguration`
这个类啥都不干，只是创建一个restTemplate的实例
```java
@Configuration
public class CloudConfiguration {
    @Bean
    public RestTemplate restTemplate(){
        return new RestTemplate();
    }
}
```
启动类
```java
@SpringBootApplication
@EnableDiscoveryClient
@ComponentScan(basePackages = {"com.edi.learn"})
@EnableJpaRepositories(basePackages = {"com.edi.learn.cloud.command"})
@EnableMongoRepositories(basePackages = {"com.edi.learn.cloud.query"})
@EnableAutoConfiguration()
public class Application {

    public static void main(String args[]){
        SpringApplication.run(Application.class, args);
    }
}
```
配置文件的修改上面已经提过了，这里就不再重复。

### Order Serivce
就启用SpringCloud来说，与上面没有任何区别。为了让OrderSaga能正常收到并处理来自于prodcut-service的事件，必须要进行额外配置。前一篇文章中提到的`@ProcessGroup`，并不适用于Saga，同时，Axon3中，目前对于Saga处理distributed event并不是很友好，3.0.4以前，Saga只能支持绑定一个EventStore，但是分布式情况下，一个service可能要监听多个queue，所以3.0.4中，支持了自定义Saga配置，即可以声明一个<saga_name>+SagaConfiguration作为Bean名，并返回SagaConfiguration类型的Bean。为了让Saga能处理来自于外部MQ的事件，我们必须提供一个orderSagaConfiguration。
```java
@Bean
public SpringAMQPMessageSource queueMessageSource(Serializer serializer){
    return new SpringAMQPMessageSource(serializer){
        @RabbitListener(queues = "orderqueue")
        @Override
        @Transactional
        public void onMessage(Message message, Channel channel) throws Exception {
            LOGGER.debug("Message received: "+message.toString());
            super.onMessage(message, channel);
        }
    };
}

@Bean
public SagaConfiguration<OrderSaga> orderSagaConfiguration(Serializer serializer){
    SagaConfiguration<OrderSaga> sagaConfiguration = SagaConfiguration.subscribingSagaManager(OrderSaga.class, c-> queueMessageSource(serializer));
    //sagaConfiguration.registerHandlerInterceptor(c->transactionManagingInterceptor());
    return sagaConfiguration;
}

@Bean
public TransactionManagingInterceptor transactionManagingInterceptor(){
    return new TransactionManagingInterceptor(new SpringTransactionManager(transactionManager));
}
```
如上面代码，自行指定Saga的message source，这样来自于product-service写入mq的ProductReservedEvent等事件就能被Saga正确处理。
这里要注意的是事务问题，由于我们是通过MQ的onMessage来启动具体的SagaCommandHandler，上下文中并未定义事务特性，但是由于我们引入了Spring的jpa包，axon3的auto configuration会自动启用SagaJpaRepository，也就是说，onMessage方法线程执行时，会牵扯到DB的更新，必须得给它指定一个transaction manager。这里有两种方法：
1. 使用@Transactional 注解，让Spring自行配置；
2. 在SagaConfiguration中注册TransactionManagingInterceptor。

另外，由于在创建订单时，只传了Product的Id，根据id去查询当前product的最新详情，需要请求Product Service的query端。这个query端我们是用`spring-boot-starter-data-rest`直接暴露出去的[HATEOAS](https://en.wikipedia.org/wiki/HATEOAS)(Hypermedia as the Engine of Application State)风格的RESTFul接口。即是说，要做一个跨服务的REST请求，且要支持HATEOAS，那么我们就使用[Feign](https://github.com/OpenFeign/feign)加上`spring-boot-starter-hateoas`。
1. 更新pom
```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-feign</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-hateoas</artifactId>
</dependency>
```
2. 在order-service中添加一个Feign Client
```java
@FeignClient(value = "product-service")
public interface ProductService {

    @RequestMapping(value = "/products", method = RequestMethod.GET)
    Resources<ProductDto> getProducts();

    @RequestMapping(value = "/products/{id}", method = RequestMethod.GET)
    ProductDto getProduct(@PathVariable("id") String productId);
}
```
3. 在SpringBootApplication中启用FeignClient和HypermediaSupport
```java
@SpringBootApplication
@EnableDiscoveryClient
@ComponentScan(basePackages = {"com.edi.learn"})
@EnableJpaRepositories(basePackages = {"com.edi.learn.cloud.command"})
@EnableMongoRepositories(basePackages = {"com.edi.learn.cloud.query"})
@EnableFeignClients(basePackages = {"com.edi.learn.cloud.common.web"})
@EnableHypermediaSupport(type = EnableHypermediaSupport.HypermediaType.HAL)
public class Application {

    public static void main(String args[]){
        SpringApplication.run(Application.class, args);
    }
}
```
ProductDto都是封装属性的POJO，就不写了。这样我们就可以在代码中直接注入ProductService，并调用相应方法从product-service端取数据了。

## 总结
至此，Axon3与SpringCloud的集成已完毕。Axon3使用SpringCloud提供的服务注册和发现机制，来进行Command的分发和处理。具体运行情况我就不写了，大家可自行修改order-service的配置，去跑多个order-service。留个悬念，由于是同一段代码和配置，mq我们使用fanout，即分发的模式，所有节点都会收到ProductReservedEvent，是否所有节点都会处理呢？

###### 写在后面的话
截止到本篇，Axon3使用的大部分功能都已经做了入门介绍，并写了例子，作为研究，算是入门了,尤其是文档中没有说明的一些关键地方，我都在文中提了出来。掉过不少坑，看了很多源码， 回头看来，我对Axon3的设计是肯定与失望并存。
肯定的是Axon3的易用性与性能，尤其是DisruptorCommandBus配合CachingGenericEventSourcingRepository（采用了LMAX的[Disruptor框架](https://lmax-exchange.github.io/disruptor/)，可以看下一篇比较早的文章介绍，猛击[这里](http://blog.trifork.com/2011/07/20/processing-1m-tps-with-axon-framework-and-the-disruptor/)或[中文翻译版](http://ifeve.com/axon/)）;
失望的是Axon3更多的优化和针对都集中在单体应用上，对分布式和微服务的集成稍显简单，例如负载均衡的支持、容错性的支持等，目前尚未看到介绍。
当然，这块现在也才刚刚起步，后续应该会变得越来越好。原期望于Axon3直接把这块做掉或者提供支持，现在看来是否我想太多，这块本就不该它做呢？欢迎加群57241527讨论。

照例，本文源码：https://github.com/EdisonXu/sbs-axon/tree/master/lesson-7
