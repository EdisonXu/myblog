---
title: CQRS和Event Souring系列（九）：AxonFramework与SpringCloud的整合
date: 2017-04-01 15:01:51
tags:
- CQRS
- axon
- DDD
- eventsourcing
---
> 上一篇里，我们在利用Axon3的DistributeCommand的JGroup支持，和DistributedEvent对AMQP的支持，实现了分布式环境下的CQRS和EventSourcing。
> 在这一篇中，我们将把Axon3与当下比较火热的微服务框架——SpringCloud进行整合。

###### 写在前面的话
AxonFramework对SpringCloud的支持，是从3.0.2才开始的，但是在3.0.2和3.0.3两个版本，均存在blocking bug，所以要想与SpringCloud完成整合，版本必须大于等于3.0.4。
PS：连续跳坑，debug读代码，帮Axon找BUG，血泪换来的结论……好在社区足够活跃，作者也比较给力，连续更新。
