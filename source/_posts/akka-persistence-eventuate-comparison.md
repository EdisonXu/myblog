---
title: (译)Akka Persistence和Eventuate的对比
date: 2017-01-22 17:23:53
tags:
- eventsourcing
- eventuate
- akka
---
> 在实现微服务架构中，遇到了分布式事务的问题。Event-sourcing和CQRS是一个比较适合微服务的解决方案。在学习过程中，遇到了这篇文章，觉得很不错，特地翻译给大家。本文翻译自：[A comparison of Akka Persistence with Eventuate](http://krasserm.github.io/2015/05/25/akka-persistence-eventuate-comparison/)

Akka Persistence和Eventuate都是Scala写的，基于Akka的event-sourcing和CQRS工具，以不同的方式实现分布式系统方案。关于这两个工具的详情，请参见他们自己的在线文档。

我是Akka Persistence和Eventuate的原作者，目前主要关注在Eventuate的开发实现。当然，我的意见肯定会带有偏见;) 言归正传，如果我哪里写的不对，请一定一定告之我。

## Command side
在Akka Persistence中，command这边(CQRS中的C)是由`PersistentActor`(PA)来实现的，而Eventuate是由`EventSourcedActor`(EA)来实现的。他们的内部状态代表了应用的写入模型。

PA和EA根据写入模型来对新的command进行校验，如果校验成功，则生成并持久化一条/多条event,后续用于更新内部状态。当crash或正常的应用重启,内部状态可以通过重演整个event log中已持久化的event或从某一个snapshot开始重演，来恢复内部状态。PA和EA都支持发送消息到其他actor的至少送达一次机制, Akka Persistence提供了`AtleastOnceDelivery`来实现，而Eventuate则使用`ConfirmedDelivery`。

从这个角度来看，PA和EA非常相似。一个主要的区别是，PA必须是单例，而EA则是可复制和同步修改的多实例。如果Akka Persistence意外地创建和更新了两个具有相同`persistenceId`的PA的实例，那么底层的event log将会被污染，要么是覆盖已有事件，要么把彼此冲突的事件拼接了起来（重演结果将不再准确）。Akka Persitence的event log设计只容许一个*writer*，并且event log本身是不能被共享的。

在Eventtuate中，EA可以共享同一个event log。基于事先自定义的event路由规则，一个EA发出的的event可以被另一个EA消费。换而言之，EA之间通过这个共享的event log可以进行协作，例如不同类型的EA一起组成一个分布式业务流程，或者实现状态复制中多地址下相同类型的EA的重建和内部状态的更新。这里的多地址甚至可以是全局分布的(*globally distributed*)。多地址间的状态复制是异步的，并保证可靠性。

## Event Relations
在Akka Persistence中，每个PA产生的event是有序的，而不同PA产生的event之间是没有任何关联性的。即使一个PA产生的event是比另一个PA产生的event早诞生，但是Akka Persistence不会记录这种先后顺序。比如，PA<sub>1</sub>持久化了一个事件e<sub>1</sub>，然后发送了一个command给PA<sub>2</sub>，使得后者在处理该command时持久化了另一个事件e<sub>2</sub>，那么显然e<sub>1</sub>是先于e<sub>2</sub>的，但是系统本身无法通过对比e<sub>1</sub>和e<sub>2</sub>来决定他们之间的这种先后的关联性。

Eventuate额外跟踪记录了这种happened-before的关联性(潜在的因果关系)。例如，如果EA<sub>1</sub>持久化了事件e<sub>1</sub>，EA<sub>2</sub>因为消费了e<sub>1</sub>而产生了事件e<sub>2</sub>，那么e<sub>1</sub>比e<sub>2</sub>先发生的这种关联性会被记录下来。happen-before关联性由[vector clocks](http://rbmhtechnology.github.io/eventuate/architecture.html#vector-clocks)来跟踪记录，系统可以通过对比两个event的vector timestamps来决定他们之间的关联性是先后发生的还是同时发生的。

跟踪记录event间的happened-before关联是运行多份EA relica的前提。EA在消费来自于它的replica的event时，必需要清楚它的内部状态的更新到底是先于该事件的，还是同时发生(可能产生冲突)。

如果最后一次状态更新先于准备消费的event，那么这个准备消费的event可被当作一个普通的更新来处理；但如果是同时产生的，那么该event可能具有冲突性，必须做相应处理，比如，
* 如果EA内部状态是[CRDT](http://en.wikipedia.org/wiki/Conflict-free_replicated_data_type)，则该冲突可以被自动解决(详见Eventuate的[operation-based CRDTs](http://rbmhtechnology.github.io/eventuate/user-guide.html#operation-based-crdts))
* 如果EA内部状态不是CRDT，Eventuate提供了进一步的方法来跟踪处理冲突,根据情况选择自动化或手动交互处理的方式。

## Event logs
前文提到过，Akka Persistence中，每一个PA有自己的event log。根据不同的存储后端，event log可冗余式的存于多个node上(比如为了保证高可用而采用的同步复制)，也可存于本地。不管是哪种方式，Akka Persistence都要求对event log的强一致性。

比如，当一个PA挂掉后，在另外一个node上恢复时，必须要保证该PA能够按正确的顺序读取到所有之前写入的event，否则这次恢复就是不完整的，可能会导致这个PA后面会覆写已存在的event，或者把一些与evet log中已有还未读的event有冲突的新event直接拼到event log后面，进而导致状态的不一致。所以，只有支持强一致性的存储后端才能被Akka Persistence使用。

AKka Persistence的写可用性取决于底层的存储后端的写可用性。根据[CAP理论](http://en.wikipedia.org/wiki/CAP_theorem)，对于强一致性、分布式的存储后端，它的写可用性是有局限性的，所以，Akka Persistence的command side选择CAP中的CP。

这种限制导致Akka Persistence很难做到全局分布下应用的强一致性，并且所有event的有序性还需要实现全局统一的协调处理。Eventuate在这点上做得要更好：它只要求在一个location上保持强一致性和event的有序性。这个location可以是一个数据中心、一个(微)服务、分布式中的一个节点、单节点下的一个流程等。

单location的Eventuate应用与Akka Persistence应用具有相同的一致性模型。但是，Eventuate应用通常会有多个location。单个location所产生的event会异步地、可靠地复制到其他location。跨location的evet复制是Eventuate独有的，并且保留了因果事件的存储顺序。不同location的存储后端之间并不直接通信，所以，不同location可以使用不同的存储后端。

Eventuate中在不同location间复制的event log被称之为**replicated event log**，它在某一个location上的代表被称为**local event log**。在不同location上的EA可以通过共享同一个replicated event log来进行event交换，从而为EA状态的跨location的状态复制提供了可能。即便是跨location的网络发生了隔断(network partition)，EA和它们底层的event log仍保持可写。从这个角度来说，一个多location的Eventuate应用从CAP中选择了AP。网络隔断后，在不同location的写入，可能会导致事件冲突，可用前面提到的方案去解决。

通过引入分割容忍（系统中任意信息的丢失或失败，不影响系统的继续运作）的location，event的全局完整排序将不再可能。在这种限制下的最强的部分排序是因果排序（casual ordering），例如保证happened-before关联关系的排序。Eventuate中，每一个location保证event以casual order递交给它们的本地EA(以及View，具体参见[下一节](#Query-side))。并发event在个别location的递交顺序可能不同，但在指定的location可重复提交的。

## Query side

Akka Persistence中，查询的一端(CQRS中的Q)可以用`PersistentView`(*PV*)来实现。目前一个PV仅限于消费一个PA所产生的event。这种限制在Akka的邮件群里被[大量讨论](https://groups.google.com/forum/#!msg/akka-user/MNDc9cVG1To/blqgyC7sIRgJ)过。从Akka2.4开始，一个比较好的方案是[Akka Persistence Query](http://doc.akka.io/docs/akka/2.4.0/scala/persistence-query.html)：把多个PA产生的event通过storage plugin进行聚合，聚合结果称为[Akka Streams](http://doc.akka.io/docs/akka-stream-and-http-experimental/1.0/scala.html)，把Akka Streams作为PV的输入。

Eventuate中，查询的这端由`EventsourcedView`(*EV*)来实现。一个EV可以消费来自于所有共享同一个event log的EA所产生的event，即使这些EA是全局分布式的。event永远按照正确的casual order被消费。一个Eventuate应用可以只用一个replicated event log，也可以用类似以topic形式区分的多个event log。未来的一些扩展将允许EV直接消费多个event log，同时，Eventuate的Akka Stream API也在规划中。

## Storage plugins

从storage plugin的角度看，Akka Persistence中event主要以`persistenceId`来区分管理，即每个PA实例拥有自己的event log。从多个PA实例进行event聚合就要求要么在storage后端创建额外的索引，要么创建实时的event流组成图(*stream composition*)，来服务查询。Eventuate中，从多个EA来的event都存储在同一个共享的event log中。在恢复时，没有预定义`aggregateId`的EA可消费该event log中的所有event，而定义过`aggregateId`的EA则只能作为路由目的地消费对应`aggregateId`的event。这就要求Eventuate的storage plugin必须维护一个独立index，以便于event通过`aggregateId`来重演。

Akka Persistence提供了一个用以存储日志和snapshot的公共storage plguin API，[社区贡献](http://akka.io/community/)了很多具体实现。Eventuate在未来也会定义一个公共的storage plugin API。就目前而言，可在LevelDB和Canssandra两者间任选一个作为存储后台。

## Throughput

Akka Persistence中的PA和Eventuate中的EA都可以选择是否保持内部状态与event log中的同步。这关系到应用在写入一个新的event前，需要对新command和内部状态所进行的校验。为了防止被校验的是陈旧状态(*stale state*)，新的command必须要等到当前正在运行的写操作成功结束。PA通过`persist`方法支持该机制(相反对应的是`persistAsync`)，EA则使用一个`stateSync`的布尔变量。

同步内部状态与event log的后果是造成吞吐率的下降。由于event批量写入实现的不同，Akka Persistence中的这种内部状态同步比Eventuate所造成的的影响要更大。Akka Persistence中，event的批处理只有在使用`persistAsync`时，才是在PA层面的，而Eventuate在EA和storage plugin两个地方分别提供了批处理，所以对于不同的EA实例所产生的event，即使他们与内部状态要同步，也能被批量写入。

Akka Persistence和Eventuate中，单个PA和EA实例的吞吐率大致上是一样的(前提是所用的storage plugin具有可比性)。但是，Eventuate的整体吞吐率可以通过增加EA实例来得到提升，Akka Persistence就不行。这对于按照每个聚合一个PA/EA的设计，且有成千上万的活跃(可写)实例的应用，就显得特别有意义。仔细阅读Akka Persistence的代码，我认为把批处理逻辑从PA挪到独立的层面去，应该不需要很大的功夫。

## Conclusion

Eventuate支持与Akka Persistence相同的一致性模型，但是额外支持了因果一致性，对于实现EA的高可用和分隔容忍(CAP中的AP)是必要条件。Eventuate还支持基于因果排序、去重复event流的可靠actor协作。从这些角度来看，Eventuate是Akka Persistence功能性的超集。

如果选择可用性高于一致性，冲突发现和(自动或交互式的)解决必须是首要考虑。Eventuate通过提供operation-based CRDT以及发现和解决应用状态冲突版本的工具、API，来提供支持。

对于分布式系统的弹性来说，处理错误比预防错误要显得更为重要。一个临时与其他location掉队分隔的location能继续保持运作，使得Eventuate成为离线场景的一个有意思的选择。

Eventuate现在仍是一个比较早期的项目，2014年末发布原型，2015年开源。目前是在[Red Bull Media House](http://www.redbullmediahouse.com/) (RBMH) [Open Source Initiative](http://rbmhtechnology.github.io/)下进行开发，主要用于RBMH的内部项目。

> 年前年后杂七杂八事情太多，导致一直没能专心做研究，进度缓慢。本篇翻译有些地方可能比较难懂，因为确实没足够时间去研究Eventuate和Akka Persistence，对于作者有些表达的不是很清晰的地方，弄得还不是很清楚，只能字面上翻过来。以后再慢慢修正。
