---
title: 微服务分布式事务实现
tags:
- 分布式
- 分布式事务
- kafka
- redis
---
> 在分布式架构中，尤其是微服务中，一个业务逻辑的具体执行可能在多个节点上执行，使得传统的Transaction无法在分布式中得到保障。本文利用Kafka、MongoDB的特性，提出一种实现分布式事务的基于最终一致性的解决方案。

## Transaction的目的
首先，我们来看下`事务`(Transaction)的根本目的是什么？
* 联合性成功或回退
* 并发时保证原子性操作
在非分布式的应用中，通常事务都是基于DB本身的ACID特性来实现。
- Atomic (原子性 ) 事务对数据的修改，要么全部执行，要么全部不执行
- Consistent (一致性) 在事务开始前和完成后，数据库的完整性没有被破坏。
- Isolated (隔离性) 允许多个并发事务同时对数据进行读写和修改。
- Durable (持久性) 事务结束后，对数据的修改时永久性的。

而在分布式中，没有了DB所提供的`ACID`特性，多个逻辑调用可能分布在不同进程、不同节点，背后采用的数据库也有可能不同，导致了在分布式环境中，如果要实现ACID特性的事务，就意味着会有大量同步交互而带来的阻塞，导致系统性能及可用性的下降。所以，Eric Brewer提出了著名的`CAP定理`——对于一个分布式计算系统来说，不可能同时满足以下三点：
- Consistence (强一致性) 针对每一次修改，所有节点均能访问到同样的修改后的最新数据
- Availability (可用性) 每次请求都必能获取到非错的响应
- Partition Tolerance (分区容错性) 系统如果不能在时限内达成数据一致性，就意味着发生了分区的情况，必须就当前操作在C和A之间做出选择。

基于这个定理，在分布式系统中，为了提高性能，出现了针对分布式系统的`BASE`特性：
- Basically Available (基本可用性)
- Soft state (可变状态) 系统中的状态随着时间在变化着，即便没有任何输入。这是最终一致性导致的。
- Eventual consistency (最终一致性) 系统保证，在没有新的更新的情况下，最终（在不一致的窗口关闭后）所有访问都将返回最后更新的值。
结论：分布式系统下，最好使用最终一致性而非传统的强一致性。

## 思路
在分布式中实现可靠的最终一致性，可采用以下方案：
1. 基于Event Driven，提供**可靠**的事件机制，来实现统一的成功或回退；
   这里的**可靠**指的是事件机制本身是取C和A，即强一致性并且一直可用。
2. 消息处理的独占性；
   对于带有事务性的消息，每一个处理者都是排他性的，即一个消息同一时间仅有一个消费者。
3. 利用读写分离，实现对外的一致性；
4. 采用消息本身

## 实现
废话不多说，开始举例：
    假定电商中用户下单，系统需要在下单的同时对商品的库存进行预留。

### 先约定名词：
- `OrderService`用于创建订单
- `ProductService`用于预留库存
- `EventStore`用于持久化Event，并能提供基于EventID的分布式锁机制，这里使用MongoDB
- `EventBus`用于向EventStore存event，并向消息队列Kafka写入event
- `RMDB`实际存储订单和商品库存的数据库
- `Kafka` Kafka是高性能分布式队列，本身保证了消息的高可用性和时序性

![](/images/2017/03/cluster_transaction.png)

<span style="color:red">
这里有几点需要注意：
1. RMDB与EventBus往EventStore内写Event捆绑在同一个Transaction中；
2. 实时产生事件时，是通过把EventBus发送消息到Kafka整个行为作为callback放到transaction commit以后去触发的。原因是通常情况下，写DB这整个transaction可能会比发送消息到kafka慢，会造成Event的消费者在处理业务逻辑时，尝试去更新EventStore内的event时找不到；
3. EventBus需要实现一个`Schedular`，定期的(50~100ms?)从Event Store里去取所在业务节点所对应的事件(提前注册),对于具有相同TransactionId的一组Event，重发所有State为Handled的消息。
</span>

### Event的数据结构为：


字段             | 描述
--             | --
Id             | 每个Event在整个分布式系统中的全局唯一ID
TransactionId  | 事务的全局唯一ID
Payload        | 具体的对象数据
Type           | Event的类型，如Create_Order
Topic          | 目标Kafka的topic名
State          | Event当前的状态:New-新建（默认），Handled-消费者修改
CreateTime     | 该Event的创建时间

### 正常情况下Event产生的顺序及其消费者

1. `OrderService`创建`Create_Order_Event`
2. `ProductService`消费`Create_Order_Event`
3. `ProductService`创建`Reserve_Order_Event`
4. `OrderService`消费`Reserve_Order_Event`，最终写入一个`Order_Confirmed_Event`

### 几种异常情况
1. `ProductService`在库存不足时产生，产生 `Not_Enough_Product_Event` 。`OrderService`在收到后，将产生`Order_Cancelled_Event`；
2. `ProductService`在6-10的操作中发生了任何异常情况，则产生`Reserve_Failed_Event`。同样，`OrderService`在收到后，将产生`Order_Cancelled_Event`；
3. DB插入成功，Kafka写入失败。对于这种情况，EventBus本身应实现
3. 当存在多份`ProductService`时，在监听`OrderService`所发出的事件时，都是Kafka Consumer，Kafka 支持分组模式，同组内对于一个topci的Consumer，只有一个能消费事件。为提高性能，Kafka默认采用的是auto-commit，即一读到event，kafka consumer的api会自动将zookeeper上的offset更新。为了防止取到event的节点，在处理过程中crash，有两种解决手段：
- 修改auto-commit为false，手动在第10步
