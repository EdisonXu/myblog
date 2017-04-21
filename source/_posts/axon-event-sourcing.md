---
title: CQRS和Event Souring系列（五）： Axon使用EventSourcing和AutoConfigure
date: 2017-03-30 17:52:23
tags:
- CQRS
- axon
- DDD
- eventsourcing
---
> 继上一篇集成SpringBoot后，本篇将继续完成小目标：
> 1. 使用EventSourcing
> 2. 使用AutoConfigure配置Axon

前一篇中看到配置Axon即便在Spring中也是比较麻烦的，好在Axon提供了`spring-boot-autoconfigure`，提供了Spring下的一些默认配置，极大地方便了我们的工作。
启用也是非常方便的，在上一篇的基础上，我们只需要干三件事即可达成目标：
1. 引入`spring-boot-autoconfigure`
2. 删除JpaConfig类
3. 去除`BankAccount`中的Entity声明

由于提供的application.properties里关于数据库的配置信息本身就是符合SpringDatasource定义的，所以，SpringBoot在检测到该配置后自动启用JPA。
`spring-boot-autoconfigure`中`AxonAutoConfiguration`类帮我们提供了最常用的`CommandBus`、`EventBus`、`EventStorageEngine`、`Serializer`、`EventStore`等，所以可以直接运行了。
在该类中有一段
```java
@ConditionalOnBean(EntityManagerFactory.class)
@RegisterDefaultEntities(packages = {"org.axonframework.eventsourcing.eventstore.jpa",
        "org.axonframework.eventhandling.tokenstore",
        "org.axonframework.eventhandling.saga.repository.jpa"})
@Configuration
public static class JpaConfiguration {

    @ConditionalOnMissingBean
    @Bean
    public EventStorageEngine eventStorageEngine(EntityManagerProvider entityManagerProvider,
                                                 TransactionManager transactionManager) {
        return new JpaEventStorageEngine(entityManagerProvider, transactionManager);
    }

    @ConditionalOnMissingBean
    @Bean
    public EntityManagerProvider entityManagerProvider() {
        return new ContainerManagedEntityManagerProvider();
    }

    @ConditionalOnMissingBean
    @Bean
    public TokenStore tokenStore(Serializer serializer, EntityManagerProvider entityManagerProvider) {
        return new JpaTokenStore(entityManagerProvider, serializer);
    }

    @ConditionalOnMissingBean(SagaStore.class)
    @Bean
    public JpaSagaStore sagaStore(Serializer serializer, EntityManagerProvider entityManagerProvider) {
        return new JpaSagaStore(serializer, entityManagerProvider);
    }
}
```
所以，当我们提供了JPA相关配置，以及mysql-connector后，这些Bean也会被启用，可以看到里面默认的`EventStoreEngine`就是`JpaEventStorageEngine`。
执行后，我们可以看到数据库中创建了如下表
![](/images/2017/03/db.png)

其中`domain_event_entry`就是用来保存对Aggregate状态造成改变的所有Event的表。如果不做特别声明，所有Event都会记录在这张表里。
表内容
![](/images/2017/03/domainevents.png)
其中，比较重要的字段有
- pay_load Event的具体内容
- pay_load_type Event的类型，Axon在ES(Event Sourcing)时会通过这个反射出来原来的Java class
- time_stamp 该Event发生的时间
- aggregate_identifier event所对应Aggregate的唯一标识，在ES时，只有相同identifier的event才会一起回溯
- sequence_number 同一Aggregate对应的event发生的序列号，回溯时严格按照该顺序

值得注意的是，在使用EventSourcing时，由于Aggregate本身的状态是通过ES获得的，所以所有对于Aggregate状态变化的动作一定都是放在`@EventHandler`里的，否则将会造成状态丢失。
预告一下，基本介绍已经完毕，下一篇开始，进入复杂的实现。
