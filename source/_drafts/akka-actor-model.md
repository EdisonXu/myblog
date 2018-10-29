---
title: Akka系列：（2）Actor模型
tags:
- akka
- actor
- 并发
---
>由于`AKka`的核心是`Actor`，而`Actor`是按照`Actor`模型进行实现的，所以在使用`Akka`之前，有必要弄清楚什么是`Actor`模型。

## Actor模型
`Actor模型`最早是1973年Carl Hewitt、Peter Bishop和Richard Seiger的论文中出现的，受物理学中的广义相对论([general relativity](https://en.wikipedia.org/wiki/General_relativity))和量子力学([quantum mechanics](https://en.wikipedia.org/wiki/Quantum_mechanics))所启发，为解决并发计算的一个数学模型。

`Actor模型`所推崇的哲学是"一切皆是Actor"，这与面向对象编程的"一切皆是对象"类似。
但不同的是，在模型中，Actor是一个运算实体，它遵循以下规则：
- 接受外部消息，不占用调用方（消息发送者）的CPU时间片
- 通过消息改变自身的状态
- 创建有限数量的新`Actor`
- 发送有限数量的消息给其他`Actor`

很多语言都实现了`Actor模型`，而其中最出名的实现要属`Erlang`的。`Akka`的实现借鉴了不少`Erlang`的经验。

## Actor模型的实现
`Akka`中`Actor`接受外部消息是靠`Mailbox`，参见下图
![](../images/2018/10/actor-model.png)

对于`Akka`，它又做了一些约束：
- 消息是不可变的
- Actor本身是无状态的
