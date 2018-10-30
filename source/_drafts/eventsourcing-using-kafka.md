---
title: (译)eventsourcing-using-kafka
tags:
- kafka
- eventsourcing
---
> 原文地址：https://blog.softwaremill.com/event-sourcing-using-kafka-53dfd72ad45d

在创建一个EventSourced系统时，在面对如何持久化这个问题上，有多种选项可选。首先是[EventStore](https://eventstore.org/),一个成熟、已经经过考验的实现。或者，你可以选择[akka-persistence](https://doc.akka.io/docs/akka/snapshot/persistence.html?language=scala)来充分利用[Cassandra](https://doc.akka.io/docs/akka/snapshot/persistence.html?language=scala)的可伸缩性及actor模型的性能。另一种可能性是使用[古老的关系型数据库](https://softwaremill.com/entry-level-event-sourcing/)，将传统的`CRUD`方法与事件相结合以充分享受事务所带来的好处。

除了这些(还有更多)可能性外，由于最近引入了一些新功能，现在在[Kafka](https://kafka.apache.org/)上做EventSourcing也变的非常直接了。我们来看看如何实现。


## 什么是EventSourcing?
由于现在已经有了[大量介绍性的文章](https://eventstore.org/docs/event-sourcing-basics/)，这里就只简单介绍下。在EventSourcing中，我们不会存储系统中所用的`Entity`的“当前”状态，而是存储与该`Entity`相关的一系列`event`。每一个`event`都是一个**事实**，它描述了`Entity`上所发生的状态变化（过去时态！）。显然，事实是无可争议的，**不可改变的**。

有了这些事件流以后，我们就可以通过回溯与该Entity相关的所有的事件来获取这个Entity的最新状态。但请注意，这个过程是反过来是不可能的（即无法从最新状态去获得之前所有的事件）——如果只存了“当前”状态，我们会丢失很多有价值的历史信息。

事件驱动（`EventSourcing`）可以与更传统的状态存储和平共存。一个系统通常会处理许多实体类型(例如用户，订单，产品……)，事件驱动有可能只适用于其中某些实体。重要的是，一定要明白事件驱动并不是一个要么全选要么不选的选项，而是在我们的系统应用中面对如何管理实体状态时的另外一种实现方法。

## 在Kafka中存储事件
首先的问题是如何在Kafka中存储事件，有三种可能的策略：
1. 将所有实体类型(Entity type)的事件存储在一个单一的具有多个partition的topic中；
2. 每个实体类型一个topic，比如把所有用户相关的事件、所有产品相关的事件给分到多个不同的topic中；
3. 每个实体一个topic，比如给每一个用户和每一个产品分配一个独立的topic；

除了属性较少(low-[arity](https://en.wikipedia.org/wiki/Arity))的实体，第三种策略是不可行的。如果系统中的每个新用户都得创建一个topic，那么最终我们就会有无数个topic。由于我们无法事先预估到会有多少topic，就会导致任何聚合操作都会变得非常困难，比如要给所有用户数据创建索引(每创建一个新用户都得创建，用户数越大，创建或更细索引的时间越长，最终不可控)。

所以，我们只能从1和2之中选。两者各有优缺点：如果只有一个topic，就很容易获得一个关于所有事件的全局视图；另一方面，如果每个实体类型一个topic，那么就可以分别对每个实体类型进行独立的分区和扩展。两者之间如何选择取决于用例场景。

其实两者都选也是可以的，但是要牺牲一个额外的存储：从所有事件的topic中派生出单一实体类型的topic。
![](/images/2018/09/1_ZOS8OMTL8eq6BJ2raJNCFg.png)
在本文的剩余部分，我们以单个实体类型和单个topic为例，但很容易由此推出多个实体类型和多topic。
(注： Twitter上[Crhis Hunt](https://twitter.com/huntchr/status/970964561498054656))指出，MartinKelppmann有一篇关于如何给事件分配topic和partition的有深度的干货([猛击这里](https://www.confluent.io/blog/put-several-event-types-kafka-topic/))。

## 事件驱动的基础存储操作
我们对于一个支持事件驱动的存储系统的最基本要求是能够获取某一实体的“最新”状态。通常，每个实体都会某种id。因此，只要给出该id，我们的存储系统应该返回它的当前状态。

事件日志(`event log`)是事实的主要来源：实体最新的状态始终可以从该实体的事件流中派生出来。为此，存储引擎需要一个无状态的function，以接收事件和实体的当前状态，并返回修改后的状态：Event=>State=>State。给定一个这样的function和一个初始状态，当前状态就是事件流中所有事件的回溯。(状态修改的function必须是无状态的，以便于对相同事件可以随意调用。)

Kafka中“读取当前状态”操作的简单实现是从topic中将所有event做为流读出，然后根据实体id进行过滤后，调用给定的函数进行回溯。如果存在大量事件(并且随着时间的推移，事件的数量只会不断增加)，这将会是一个缓慢并且非常耗资源的操作。即便是将结果缓存在服务节点的内存中，仍然需要定期重新创建，比如节点挂了或者缓存过期。

![](/images/2018/09/1_Za15jyvTEytEfzWfIhCAQQ.png)
所以，我们需要一个更好的方法。这时，Kafka-Stream和State store就可以华丽登场了。
Kafka-Stream是一个分布式的程序，可以共同消化一些topic。就像常规的Kafka consumer一样，每个节点会被分配目标topic的若干partition。但是，Kafka-Stream为数据提供了更高级别的操作，可以更轻松地创建派生流。

Kafka-Stream中一个操作是将流打包到一个本地存储中，每个本地存储只包含所属节点所消费的partition的数据。目前提供了两种开箱即用的本地存储实现方法：内存存储实现和基于RocksDB的存储实现。

回到事件驱动上，我们将分配给当前节点的partition中所消化的事件存储到本地存储中，从而可以通过回溯获得对应实体的当前状态。如果我们用了RocksDB来作为存储，那么在单节点上可以处理的实体数量完全取决于磁盘大小。

下面是如何用Java API来实现将事件存到本地存储中(`serde`是serializer/deserializer的缩写):

```java
KStreamBuilder builder = new KStreamBuilder();
builder.stream(keySerde, valueSerde, "my_entity_events")
  .groupByKey(keySerde, valueSerde)
  // the folding function: should return the new state
  .reduce((currentState, event) -> ..., "my_entity_store");
  .toStream(); // yields a stream of intermediate states
return builder;
```

完整的源码请参考基于Confluent的 [orders微服务例子](https://github.com/confluentinc/kafka-streams-examples/tree/4.0.0-post/src/main/java/io/confluent/examples/streams/microservices)
(注：[Sergei Egorov](https://twitter.com/bsideup/status/970717670881538048)和[Nikita Salnikov](https://twitter.com/iNikem/status/970880555922444288)在Twitter上指出，要使用事件回溯，你可能要改变Kafka的默认参数设置，关闭time-base或size-based的限制，并可以选择启用压缩。)

## 查询当前状态
我们已经基于被分配给当前节点的partition创建了一个包含所有Entity当前状态的state store，但是如何查询呢？如果只是查询本地(当前节点)，就比较简单：
```java
streams
  .store("my_entity_store", QueryableStoreTypes.keyValueStore());
  .get(entityId);
```

但如果我想查询其他节点上的数据呢？以及我们怎么确定数据在哪个节点上呢？这里，就用上了Kafka最近引入的一个新组件：**interacitve queries**。使用它，就可以查询Kafka的meatadata找出给定Id的Entity是在哪个节点处理的相关topic的对应partition(后面使用的其实是topic partitioner)。
```java
metadataService
  .streamsMetadataForStoreAndKey("my_entity_store", entityId, keySerde)
```

然后就是如何将请求转发到合适的节点的问题了。注意，节点之间的通讯是需要自己实现的，不管是用REST、akka-remote还是其他的方式，Kafka-Stream只负责访问state store，以及提供有关给定Entity Id所在的state store的主机信息。

## 容错
state store看上去挺不错的，但是如果一个节点挂了呢？为一个partition重新创建本地的state store会是一个开销较大的操作。会因为Kafka-Stream的re-balancing机制(当新增或删除一个节点后触发)导致在一个相当长的时间内增加延迟时间和请求错误数。

这就是为什么默认情况下需要记录每个state store的持久化日志：也就是说，对state store的所有更改，都会写到另外一个**changelog-topic**中。这个topic是压缩的(我们只需要每个id的最新entry，不需要变化的历史，因为历史记录保存在事件中)，因此会小很多。对亏了这一点，在另一个节点上重新创建state store就会变得快多了。

但这仍然有可能导致重新负载的延迟。为了进一步减少这个延迟，Kafka-Stream提供了一个选项为每个存储保留若干备份副本(`num.standby.replicas`)。这些副本会同步更新changelog-topic的所有更新，只要当前节点挂了，就可以立刻变成对应partition的主state store对外提供服务。

## 一致性
在默认设置下，Kafka提供at-least-once delivery,及至少一次交付，也就是说，在节点故障的情况下，某些消息可能会被多次发送。例如，如果系统在写入state store changelog以后，没来得及commit这个事件的offset就挂了，该事件就可能会被应用到state store两次。如果我们的状态更新function(Event=>State=>State)能处理这种重复，就可以避免这种情况。但我们也可以打开Kafka的exactly-once保证，就不用靠function处理了。Kafka的exactly-once保证是适用于读写kafka的topic，而这恰恰是我们所要的：更新state store的changelog后commit offset，背后正是Kafka topic的写入操作，可以做成一个事务来完成。

因此，如果状态更新function需要，我们可以只用打开一个配置项`processing.guarantee`打开exact-once的流处理。这会导致性能下降，但是-没有任何东西是免费的。

## 事件监听
现在我们已经涵盖了基础——查询和更新每个实体的“当前”状态。那么运行时的**副作用**有哪些呢？在某些点上，考虑这个是十分有必要的，例如：
* 发送通知邮件
* 在一个搜索引擎中对实体进行索引
* 通过REST(或者SOAP、CORBA等)调用外部服务
所有的这些任务都是某种意义上的阻塞式并涉及I/O，因此最好不要把它们作为状态更新逻辑的一部分去执行，可能会导致“主”事件循环中失败率的提升，并造成性能瓶颈。

此外，状态更新function(Event=>State=>State)应当可以多次运行(防止失败或重启)，但通常情况下，对于某些事件造成副作用的情形，因尽量避免多次运行。

幸运的是，在我们处理Kafka的Topic的时候，我们有很大的灵活性。产生更新state store的事件流的阶段，可以发射未造成变化的事件(也选择发射已造成变化的)，最终生成的流/Topic(在Kafka中，topic和流式等效的)可以以任意的形式被消费，甚至可以选择在状态更新之前或之后对其进行消费。到这，我们就可以做到控制副作用无论是at-least-once还是at-most-once下


