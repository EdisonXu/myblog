---
title: CQRS和Event Souring系列（四）： Axon使用Jpa存储Aggregate状态
date: 2017-03-30 15:52:23
tags:
- CQRS
- axon
- DDD
- eventsourcing
---
> 上一篇里，介绍了Axon的基本概念，并且做了一个最简单的hello例子。本篇将更进一步，完成两个小目标：
> 1. 集成SpringBoot；
> 2. 使用Standard Repository来存储Aggregate的最新状态。

## 1. 更新Maven依赖
干几件事：
- 集成Springboot
- 加入spring-boot-starter-data-jpa(Spring提供的JPA快速包，很方便)
- 加入my-sql-connector
- 加入spring-boot-starter-web包，提供web接口调用，测试用

```xml
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>1.5.2.RELEASE</version>
</parent>

<dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-jpa</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>mysql</groupId>
            <artifactId>mysql-connector-java</artifactId>
        </dependency>
    </dependencies>
```

## 2. 提供application.properties，配置好数据库信息
```java
# Datasource configuration
spring.datasource.url=jdbc:mysql://xxx.xxx.xxx.xxx:3306/cqrs
spring.datasource.driverClassName=com.mysql.jdbc.Driver
spring.datasource.username=<username>
spring.datasource.password=<password>
spring.datasource.validation-query=SELECT 1;
spring.datasource.initial-size=2
spring.datasource.sql-script-encoding=UTF-8

spring.jpa.database=mysql
spring.jpa.show-sql=true
spring.jpa.hibernate.ddl-auto=create-drop
```

## 3. 使用Spring进行配置
```java
@Configuration
@EnableAxon
public class JpaConfig {

    private static final Logger LOGGER = getLogger(JpaConfig.class);

    @Autowired
    private PlatformTransactionManager transactionManager;

    @Bean
    public EventStorageEngine eventStorageEngine(){
        return new InMemoryEventStorageEngine();
    }

    @Bean
    public TransactionManager axonTransactionManager() {
        return new SpringTransactionManager(transactionManager);
    }

    @Bean
    public EventBus eventBus(){
        return new SimpleEventBus();
    }

    @Bean
    public CommandBus commandBus() {
        SimpleCommandBus commandBus = new SimpleCommandBus(axonTransactionManager(), NoOpMessageMonitor.INSTANCE);
        //commandBus.registerHandlerInterceptor(transactionManagingInterceptor());
        return commandBus;
    }

    @Bean
    public TransactionManagingInterceptor transactionManagingInterceptor(){
        return new TransactionManagingInterceptor(new SpringTransactionManager(transactionManager));
    }

    @Bean
  	public EntityManagerProvider entityManagerProvider() {
  		return new ContainerManagedEntityManagerProvider();
  	}

	  @Bean
    public Repository<BankAccount> accountRepository(){
        return new GenericJpaRepository<BankAccount>(entityManagerProvider(),BankAccount.class, eventBus());
    }
}
```
`@EnableAxon`会启用`SpringAxonAutoConfigurer`，后者会自动把上线文里的关键配置模块注入到Axon的config中。但这个注解未来会被替代，所以推荐使用方式为引入axon-spring-boot-autoconfigure包。下一篇文章就会介绍如何使用autoconfigure进行配置。
在本例中，我们把Event保存在内存中，所以指定EventStoreEngine为`InMemoryEventStorageEngine`。
前一篇说过，Axon会给每一个Aggregate创建一个AggregateRepositoryBean，来指定每一个Aggregate的实际Repository。这里我们直接声明BankAccount对应的Repository为一个`GenericJpaRepository`,来直接保存Aggregate的状态。`GenericJpaRepository`要求提供一个`EntityManagerProvider`，该Provider会提供具体的`EntityManager`来管理持久化。
值得注意的是，CommandBus在初始化时，需要提供一个TransactionManager，如果直接调用SimpleCommandBus的无参构造器，默认是`NoTransactionManager.INSTANCE`。本例测试时把几个command放在一个线程里串行执行，如果不提供TransactionManager，那么最终withdraw会失败。
提供TransactionManager的方式有两种：
- 如上例中直接构造器中指定；
- 注册一个TransactionManagingInterceptor；

## 4. 把Aggregate加上JPA的标准Entity注解
```java
@Aggregate(repository = "accountRepository")
@Entity
public class BankAccount {
  @AggregateIdentifier
  private AccountId accountId;

  ......

  @Id
  public String getAccountId() {
      return accountId.toString();
  }

  @Column
  public String getAccountName() {
      return accountName;
  }

  @Column
  public BigDecimal getBalance() {
      return balance;
  }
}
```
repository = "accountRepository"指定了该Aggregate对应的Repository的Bean名字，即在JpaConfig中定义的那一个。
JPA要求Entity必须有一个ID，`GenericJpaRepository`默认使用String作为EntityId的类型，而这里并没有直接用String，将会在存储时报
java.lang.IllegalArgumentException: Provided id of the wrong type for class com.edi.learn.axon.aggregates.BankAccount. Expected: class com.edi.learn.axon.domain.AccountId, got class java.lang.String
解决方法是把@Id，@Column加在getter方法上。

## 5. 配置controller接受请求并发送command
```java
@RestController
@RequestMapping("/bank")
public class BankAccountController {

    private static final Logger LOGGER = getLogger(BankAccountController.class);

    @Autowired
    private CommandGateway commandGateway;

    @Autowired
    private HttpServletResponse response;

    @RequestMapping(method = RequestMethod.POST)
    public void create() {
        LOGGER.info("start");
        AccountId id = new AccountId();
        LOGGER.debug("Account id: {}", id.toString());
        commandGateway.send(new CreateAccountCommand(id, "MyAccount",1000));
        commandGateway.send(new WithdrawMoneyCommand(id, 500));
        commandGateway.send(new WithdrawMoneyCommand(id, 300));
        commandGateway.send(new CreateAccountCommand(id, "MyAccount", 1000));
        commandGateway.send(new WithdrawMoneyCommand(id, 500));
    }
}
```
我这里是为了偷懒，直接一个post请求就可以执行一堆操作。有心者可以改下，接受参数，根据参数发送command。

## 6. 启动类
```java
@SpringBootApplication
@ComponentScan(basePackages = {"com.edi.learn"})
public class Application {  
    public static void main(String args[]){
        SpringApplication.run(Application.class, args);
    }
}
```
唯一需要注意的是，如果Application类不在JpaConfig包路径的前面，JpaConfig讲不会被Spring扫描注册到上下文中，需要指定包路径。

启动后，在http://localhost:8080/bank 发送一个POST请求，就可以看到log
```
17:53:47.099 [http-nio-8080-exec-1] INFO  c.e.l.a.c.aggregates.BankAccount - Account 2fabef76-80bc-4dfc-8f21-4b68c5969fa5 is created with balance 1000
17:53:47.229 [http-nio-8080-exec-1] INFO  c.e.l.a.c.aggregates.BankAccount - Withdraw 500 from account 2fabef76-80bc-4dfc-8f21-4b68c5969fa5, balance result: 500
17:53:47.241 [http-nio-8080-exec-1] INFO  c.e.l.a.c.aggregates.BankAccount - Withdraw 300 from account 2fabef76-80bc-4dfc-8f21-4b68c5969fa5, balance result: 200
17:53:47.246 [http-nio-8080-exec-1] INFO  c.e.l.a.c.aggregates.BankAccount - Account 2fabef76-80bc-4dfc-8f21-4b68c5969fa5 is created with balance 1000
17:53:47.253 [http-nio-8080-exec-1] WARN  o.a.c.gateway.DefaultCommandGateway - Command 'com.edi.learn.axon.command.commands.CreateAccountCommand' resulted in javax.persistence.EntityExistsException(A different object with the same identifier value was already associated with the session : [com.edi.learn.axon.command.aggregates.BankAccount#2fabef76-80bc-4dfc-8f21-4b68c5969fa5])
17:53:47.268 [http-nio-8080-exec-1] ERROR c.e.l.a.c.aggregates.BankAccount - Cannot withdraw more money than the balance!
```
可以看到故意发送的第二个`CreateAccountCommand`时，由于id相同，提示创建失败。
进一步取钱时，因余额不足报错 。

本文源码：https://github.com/EdisonXu/sbs-axon/tree/master/lesson-2
