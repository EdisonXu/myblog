---
title: CQRS和Event Souring系列（三）： Hello,Axon3
date: 2017-03-30 14:47:46
tags:
- CQRS
- axon
- DDD
---
> AxonFramework是一个轻量级的CQRS框架，支持EventSourcing，本系列将开始通过例子，StepByStep学习AxonFramework。

## 简介
[AxonFramework](www.axonframework.org)是一个基于事件驱动的轻量级CQRS框架，既支持直接持久化Aggreaget状态，也支持采用EventSourcing，使用AxonFramework的应用架构如下
![](/images/2017/03/detailed-architecture-overview.png)

引入Axon非常简单，加入Maven依赖即可
```xml
<dependency>
  <groupId>org.axonframework</groupId>
  <artifactId>axon-core</artifactId>
  <version>${axon.version}</version>
</dependency>
```
AxonFramework的源码地址：https://github.com/AxonFramework/AxonFramework
包含了如下组件；
- `core` axon的核心代码
- `amqp` 使用AMQP协议的MQ，如rabbit等，实现Event跨JVM的分发
- `distributed-commandbus-jgroups` 使用Jgroup实现跨JVM的Command分发
- `distributed-commandbus-springcloud` 与SpringCloud集成，使用DiscoveryClient和RESTemplate实现跨JVM的Command分发
- `metrics` 提供监控相关信息
- `mongo` 实现axon与mongoDB的集成
- `spring-boot-autoconfigure` 实现spring的autoconfigure支持，只需要提供相关Property就可以自动配置Axon
- `spring-boot-starter-jgroups` 用distributed-commandbus-jgroups加上spring autoconfigure，提供jgroup“一键”集成
- `spring-boot-starter` 与springboot集成
- `spring` 提供各种annotation，与spring集成

## 例子
废话不多说，我们来用一个简单的例子来说明AxonFramework最基本的使用方法：
“开一个银行账户，取钱”


## Aggregate
显然，在这个例子中，我们要实现一个Aggregate是银行账户，定义如下
```java
public class BankAccount {
    @AggregateIdentifier
    private AccountId accountId;
    private String accountName;
    private BigDecimal balance;
}
```
Axon中定义一个class是Aggregate有两种方法：
1. 在配置中直接指定，如调用.configureAggregate(BankAccount.class)；
2. 与Spring集成时，可以通过加上@Aggregate的注解标明；
结合前文DDD概念中关于Aggregate的介绍，每个Aggregate都有自己独立的全局唯一的标识符，`@AggregateIdentifier`即是这个唯一标识的标志，例子中就是银行的AccountId。一个AggregateIdentifier必须：
* 实现`equal`和`hashCode`方法，因为它会被拿来与其他标识对比
* 实现`toString`方法，其结果也应该是全局唯一的
* 实现`Serializable`接口以表明可序列化

这里用Axon提供的generateIdentifier方法来创建唯一标识：
```java
public class AccountId implements Serializable {

    private static final long serialVersionUID = 7119961474083133148L;
    private final String identifier;

    private final int hashCode;

    public AccountId() {
        this.identifier = IdentifierFactory.getInstance().generateIdentifier();
        this.hashCode = identifier.hashCode();
    }

    public AccountId(String identifier) {
        Assert.notNull(identifier, ()->"Identifier may not be null");
        this.identifier = identifier;
        this.hashCode = identifier.hashCode();
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;

        AccountId accountId = (AccountId) o;

        return identifier.equals(accountId.identifier);

    }

    @Override
    public int hashCode() {
        return hashCode;
    }

    @Override
    public String toString() {
        return identifier;
    }

}
```
## Command
在CQRS模式下，所有的“写”操作，都是发送Command来操作。Axon中Command可以是任意的POJO类，由于axon是基于事件驱动的架构，Command类处理时会被axon封装成一个`CommandMessage`。
本例只需要实现两个Command:
`CreateAccountCommand`
```java
public class CreateAccountCommand {
    private AccountId accountId;
    private String accountName;
    private long amount;
    public CreateAccountCommand(AccountId accountId, String accountName, long amount) {
        this.accountId = accountId;
        this.accountName = accountName;
        this.amount = amount;
    }
    //getter & setter
    ...
}
```
`WithdrawMoneyCommand`
```java
public class WithdrawMoneyCommand {
    @TargetAggregateIdentifier
    private AccountId accountId;
    private long amount;
    public WithdrawMoneyCommand(AccountId accountId, long amount) {
        this.accountId = accountId;
        this.amount = amount;
    }
    //getter & setter
    ...
}
```
篇幅问题，我这里省略了getter/setter方法，但是，**如果使用Jackson做序列化器，必须实现空参构造器和提供所有field的getter方法！**

## Event
Event是系统中发生任何改变时产生的事件类，典型的event就是对Aggregate状态的修改。与Command一样，Event可以是任何POJO，axon也会把Event自动封装成`EventMessage`，其中如果是Aggregate发送出来的Event，会被封装成`DomainEventMessage`。通常来说，Event最好是可序列化的。那么对应到本例，显然有两个Event：
`AccountCreatedEvent`
```java
public class AccountCreatedEvent {
    private AccountId accountId;
    private String accountName;
    private long amount;
    public AccountCreatedEvent(AccountId accountId, String accountName, long amount) {
        this.accountId = accountId;
        this.accountName = accountName;
        this.amount = amount;
    }
    //getter & setter
    ...
}
```
`MoneyWithdrawnEvent`
```java
public class MoneyWithdrawnEvent {
    private AccountId accountId;
    private long amount;

    public MoneyWithdrawnEvent(AccountId accountId, long amount) {
        this.accountId = accountId;
        this.amount = amount;
    }
    //getter & setter
    ...
}
```
一样，省略了gettter/setter，注意序列化器对构造器和getter的要求。

## CommandHandler
axon使用@CommandHandler注解来标明用来处理Command的方法，配置时会把这些CommandHandler统一加载管理，与其对应的Command形成KV键值对。在Aggregate实现BankAccount里面加入CommandHandler如下：
```java
@CommandHandler
public BankAccount(CreateAccountCommand command){
   apply(new AccountCreatedEvent(command.getAccountId(), command.getAccountName(), command.getAmount()));
}

@CommandHandler
public void handle(WithdrawMoneyCommand command){
   apply(new MoneyWithdrawnEvent(command.getAccountId(), command.getAmount()));
}
```
这里不做其他事，只简单的产生Event并使用提供的静态方法`apply`把Event发送出去。
值得一提的是，这里用一个构造器来接受`CreateAccountCommand`，至于有什么特殊，这里卖个关子，文章最后见分晓。

## EventHandler
专门用来处理Event的方法，用@EventHandler标明或使用`EventHandlingConfiguration`去注册。在BankAccount内加入：
```java
@EventHandler
public void on(AccountCreatedEvent event){
    this.accountId = event.getAccountId();
    this.accountName = event.getAccountName();
    this.balance = new BigDecimal(event.getAmount());
    LOGGER.info("Account {} is created with balance {}", accountId, this.balance);
}

@EventHandler
public void on(MoneyWithdrawnEvent event){
    BigDecimal result = this.balance.subtract(new BigDecimal(event.getAmount()));
    if(result.compareTo(BigDecimal.ZERO)<0)
        LOGGER.error("Cannot withdraw more money than the balance!");
    else {
        this.balance = result;
        LOGGER.info("Withdraw {} from account {}, balance result: {}", event.getAmount(), accountId, balance);
    }
}
```
## 配置
现在基本内容都有了，只差最后一步，对axon进行配置。Axon启动最少要指定如下几个模块：
### `CommandBus`
  `CommandBus`是用来分发Command到对应`CommandHandler`的机制。每一个Command只会发送到一个`CommandHandler`去，当有多个`CommandHandler`去订阅一个`CommandMessage`时，最后一个覆盖前面所有。
  Axon内置了四种`CommandBus`：
  - `SimpleCommandBus`
  默认，直接在发送线程里去执行command handler，执行后保存Aggregate状态和发送事件也都在同一个线程上，适用于大多数情况。

  - `AsynchrounousCommandBus`
  默认使用一个`CachedThreadPool`来起一个新线程去处理command。`CachedThreadPool`线程调用时，会检查是否有可用的线程，没有则创建。闲置线程60s后自动关闭。也可以通过config指定其他的线程池来采用不同的线程调度策略。

  - `DisruptorCommandBus`
  适用于多线程场景。`SimpleCommandBus`在遇到多线程调用时，为了保证aggregate的状态，必须要加锁，这样就降低了效率。`DisruptorCommandBus`用了开源的并发处理框架[Disruptor](http://lmax-exchange.github.io/disruptor)，用两组线程来处理多线程场景，一组用于执行command handler去更新aggregate的状态，一组用于存储和发送所产生的event到EventStore。
	但是`DisruptorCommandBus`有以下的限制：
    1. 仅支持Event Sourced Aggregates
    2. 一个Command只能改变一个Aggregate的状态。
		3. 当使用Cache的时候，一个identifier只能对应一个aggregate，即不允许两个不同类型的aggregate拥有同一个identifier
		4. 所处理的Command不能导致UnitOfWork的rollback，因为DisruptorCommandBus无法保证rollback时按照dispatch的顺序来处理。
		5. 用于更新Aggregate的command只能按照dispatch的顺序执行，无法指定顺序。
	DisruptorCommandBus可以使用DisruptorConfiguration来配置，它提供了一些进一步优化的参数。

  - `DistributedCommandBus`
  不像其他CommandBus，DistributedCommandBus并不调用任何command handler，它只是在不同JVM的commandbus之间建立一个“桥梁”。每个JVM上的DistributedCommandBus被称为“Segment”。
  ![](/images/2017/03/distributed-command-bus.png)
  DistributedCommandBus需要指定路由规则和具体的connector，这两个东东具体实现由`distributed-commandbus-xxx`模块提供。

### `EventBus`
  `EventBus`用于把event发送到subscribe它的各个handler去。Axon提供了两种EventBus的实现，都支持订阅和跟踪：
  - `SimpleEventBus` 默认的EventBus，不持久化event，一旦发送到消费者去，就会销毁。
  - `EmbeddedEventStore` 可以持久化event，以便以后replay。

### `Repository`
  即`Aggregate`的持久化方式。Axon内置了两种
  - `Standard Repositories` 代表是`GenericJpaRepository`，直接把Aggregate的最新状态存到db去。
  - `Event Sourcing Repositories` 并不直接保存Aggregate的最新状态，而是保存对Aggregate造成影响的所有Event，通过Event回溯来恢复Aggregate状态

### `EventStorageEngine`
  提供event在底层storage读写的机制，内置了若干种：
  - `InMemoryEventStorageEngine` 存储到内存中
  - `JpaEventStorageEngine` 使用JPA进行存储
  - `JdbcEventStorageEngine` 使用jdbc
  - `MongoEventStorageEngine` 使用Mongodb存储event

### `Serializer`
  由于是事件驱动框架，序列化器必不可少。Axon内置了三种：XStreamSerializer, JavaSerializer, JacksonSerializer，默认是XStreamSerializer，使用[XStream](http://xstream.codehaus.org)来做序列化，理论上比Java自带的序列化器要快。

```java
public class Application {
    private static final Logger LOGGER = getLogger(Application.class);
    public static void main(String args[]){
        Configuration config = DefaultConfigurer.defaultConfiguration()
                .configureAggregate(BankAccount.class)
                .configureEmbeddedEventStore(c -> new InMemoryEventStorageEngine())
                .buildConfiguration();
        config.start();
        AccountId id = new AccountId();
        config.commandGateway().send(new CreateAccountCommand(id, "MyAccount",1000));
        config.commandGateway().send(new WithdrawMoneyCommand(id, 500));
        config.commandGateway().send(new WithdrawMoneyCommand(id, 500));
    }
}
```
Axon提供了DefaultConfigurer来帮助我们做一些基本配置，所以我们只需要简单的做Aggregate的注册和指定一个EventStorageEngine。
这里因为是测试，用了`InMemoryEventStorageEngine`。
`CommandGateway`是对`CommandBus`的一个封装，更加方便的来发送Command。

---
本文完整代码
https://github.com/EdisonXu/sbs-axon/tree/master/lesson-1

前面说用一个构造器来接受`CreateAccountCommand`，有什么特殊地方。这里涉及到一个问题，就是Aggregate在Repository的创建。
Axon中，打开@Aggregate注解的定义会发现里面其实定义了一个repository。
```java
/**
 * Selects the name of the AggregateRepository bean. If left empty a new repository is created. In that case the
 * name of the repository will be based on the simple name of the aggregate's class.
 */
String repository() default "";
```
Axon其实会为每一个Aggregate对应一个AggregateRepository，如果不额外指定，会使用给定的StorageEngine对应的Repository。
通常情况下，如果要在Repository里面保存Aggregate，需要执行repository.newInstance(()->new BankAccount())，但如果直接提供了构造器接受command，那么axon在执行这个command，如`CreateAccountCommand`时，会自动帮你做一个newInstance的操作。
另外，有人会说，为什么要把CommandHandler、EventHandler放到Aggregate内部，能不能放到外面单独用一个类。答案是当然可以。
Axon会自动扫描带有@CommandHandler,@EventHandler的方法，加载到KV值中。
并没有明确规定说这些方法一定得放在Aggregate内部或外部，不过一般应该把仅涉及当前Aggregate状态变化的，放到Aggregate内部处理，如果牵扯到其他复杂逻辑，如查询其他Aggregate做判断等，则最好是另起一个handler类。
