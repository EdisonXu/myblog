---
title: Akka入门系列(三)：远程Actor
tags:
  - akka
  - actor
  - 并发
date: 2018-10-30 09:04:22
origin: http://test.com/1.html
categories: 
  - Java
  - 框架
  - 分布式
  - Akka
---



>虽然`Akka`在单机上可以运行上百万的`Actor`，但出于容错、负载均衡、灰度发布、提高并行度等等原因，我们仍然需要能在多个不同的服务器上运行`Actor`。所以Akka提供了`akka-remoting`的扩展包，屏蔽底层网络传输的细节，让上层以及其简单的方式使用远程的`Actor`调度。 
>官方文档：https://doc.akka.io/docs/akka/current/remoting.html

## 适用场景
`remoting`的存在其实是为`akka cluster`做底层支持的，通常并不会直接去使用remoting的包。但为了了解`cluster`的底层原理，还是有必要看下`remoting`。
同时，`remoting`被设计为`Peer-to-Peer`而非`Client-Server`，所以不适用于基于后者的系统开发，比如我们无法在一个provider为local的Actor里去查找一个`remote actor`发送消息，必须两者均为`remote actor`，才满足对等。

## 设计
`Akka`的所有设计，都是考虑了分布式的：所有`Actor`的交互都是基于事件，所有的操作都是异步的。
更多设计信息，请参考[Remote设计](https://doc.akka.io/docs/akka/current/general/remoting.html#location-transparency)，还是会获益良多。
原文中有一句话
>This effort has been undertaken to ensure that all functions are available equally when running within a single JVM or on a cluster of hundreds of machines. ***The key for enabling this is to go from remote to local by way of optimization instead of trying to go from local to remote by way of generalization*.** 

后面这半句看的不是很懂，希望有理解的朋友回复交流。


## 基本例子
`Akka`将`remoting`完全配置化了，使用时几乎只需要修改配置文件，除非自定义，否则不需要动一行代码。
`remoting`包提供了两个功能：
* 查找一个已存在的远程Actor
* 在指定的远程路径上创建一个远程Actor

### 添加依赖
在引入akka actor的基本依赖(请看前文)后，再加上remoting的依赖
``` xml
<dependency>
  <groupId>com.typesafe.akka</groupId>
  <artifactId>akka-remote_2.12</artifactId>
  <version>2.5.17</version>
</dependency>
```
### 配置
在一个`Akka`项目中启用`remote`功能的话，最基本需要在`application.conf`（Akka默认的配置文件名）中启用如下配置:
```yaml
akka {
  actor {
    provider = remote
  }
  remote {
    enabled-transports = ["akka.remote.netty.tcp"]
    netty.tcp {
      hostname = "127.0.0.1"
      port = 2552
    }
 }
}
```
基本配置包含如下四点：
* `provider`从`local`变成`remote`
* `enabled-transports`指定传输的实现
* `hostname` 指定当前`Actor`底层网络监听组件所需监听的主机名，如果不指定，默认会调用InetAddress.getLocalHost().getHostAddress()来获取当前主机的IP
* `port` 指定当前`Actor`底层网络监听组件所需监听的端口，**如果设置为0，则会生成一个随机的端口**

**由于要测试下本地去寻找远程actor，所以本文的代码例子中，用`remote.conf`作为配置文件名**

>注意
>如果在同一个主机上启动多个远程Actor，那么`port`一定要不同。因为远程Actor的底层会启动一个网络监控组件，该组件会去监听指定IP或域名的指定端口。如果都相同，肯定会有一个绑定失败。

### 查找一个远程Actor
我们创建一个远程Actor，一会儿去查找它。注意，这里加载了remote.conf，但覆盖了端口为2551，目的是在本地模拟一个远端的Actor。如果觉得在本地起不好理解，就可以找一台服务器，把`akka.remote.netty.tcp.hostname`也覆盖掉换成服务器的IP，或者干脆另起一个配置文件。
```java
public class ToFindRemoteActor extends AbstractActor {

    LoggingAdapter log = Logging.getLogger(getContext().system(), this);

    @Override
    public void preStart() throws Exception {
        log.info("ToFindRemoteActor is starting");
    }

    @Override
    public Receive createReceive() {
        return receiveBuilder()
                .match(String.class, msg->{
                    log.info("Msg received: {}", msg);
                })
                .build();
    }

    public static void main(String[] args) {
        Config config = ConfigFactory.parseString(
                "akka.remote.netty.tcp.port=" + 2551)
                .withFallback(ConfigFactory.load("remote.conf"));

        // Create an Akka system
        ActorSystem system = ActorSystem.create("sys", config);

        // Create an actor
        system.actorOf(Props.create(ToFindRemoteActor.class), "toFind");
    }
}
```
启动后，可以看到控制台有日志打印出来：
```
[INFO] [10/26/2018 11:54:33.684] [main] [akka.remote.Remoting] Starting remoting
[INFO] [10/26/2018 11:54:34.198] [main] [akka.remote.Remoting] Remoting started; listening on addresses :[akka.tcp://sys@127.0.0.1:2551]
[INFO] [10/26/2018 11:54:34.200] [main] [akka.remote.Remoting] Remoting now listens on addresses: [akka.tcp://sys@127.0.0.1:2551]
[INFO] [10/26/2018 11:54:34.363] [sys-akka.actor.default-dispatcher-7] [akka://sys/user/toFind] ToFindRemoteActor is starting
```

这时，我们先尝试在一个本地进程里去查找这个Actor：
```java
public class Main1
{
    public static void main( String[] args )
    {
        ActorSystem system = ActorSystem.create("main1");
        LoggingAdapter log = Logging.getLogger(system, Main2.class);
        ActorSelection toFind = system.actorSelection("akka.tcp://sys@127.0.0.1:2551/user/toFind");
        toFind.tell("hello", ActorRef.noSender());
    }
}
```
注意，这里我没有提供application.conf，而且也没有指定其他的配置文件！所以这里的ActorSystem起的完全是本地模式。我们运行一下，看看是远端的Actor是否会打印hello呢？
```
[INFO] [10/26/2018 14:02:27.661] [local-akka.actor.default-dispatcher-2] [akka://local/deadLetters] Message [java.lang.String] without sender to Actor[akka://local/deadLetters] was not delivered. [1] dead letters encountered. If this is not an expected behavior, then [Actor[akka://local/deadLetters]] may have terminated unexpectedly, This logging can be turned off or adjusted with configuration settings 'akka.log-dead-letters' and 'akka.log-dead-letters-during-shutdown'.
```
结果给出了这样的日志，说明并没有发送成功。再次验证了上面提到的Akka Remote的`Peer-to-Peer`设计，必须要求对等，两边都是`remote`！

好了，回到正轨上，我们来看看如何正确的去寻找一个远端actor并发送消息。
```java
public class Main2 {

    public static void main(String[] args) {
        Config config = ConfigFactory.load("remote.conf");
        // Create an Akka system
        ActorSystem system = ActorSystem.create("main2", config);

        // Find remote actor
        ActorSelection toFind = system.actorSelection("akka.tcp://sys@127.0.0.1:2551/user/toFind");
        toFind.tell("hello", ActorRef.noSender());
    }
}
```
这里加载了remote.conf，启用remote provider。可以在ToFindRemoteActor的控制台有如下日志:
```
[INFO] [10/26/2018 14:12:11.376] [sys-akka.actor.default-dispatcher-4] [akka://sys/user/toFind] Msg received: hello
```
说明找到且正常收到了消息。

### 创建一个远程的Actor
在Main2里，我们相当于起了一个监听着`127.0.0.1：2552`的`ActorSystem`，那我们把Main2当作远程系统(如果觉得127.0.0.1不太好理解，可以把它打包放到其他服务器，并指定hostname为这个服务器的IP)，在当前机器去尝试在Main2这个远端起一个Actor。
远程Actor代码如下：
```java
public class ToCreateRemoteActor extends AbstractActor {

    LoggingAdapter log = Logging.getLogger(getContext().system(), this);

    @Override
    public void preStart() throws Exception {
        log.info("ToCreateRemoteActor is starting");
    }

    @Override
    public Receive createReceive() {
        return receiveBuilder()
                .match(String.class, msg->{
                    log.info("Msg received: {}", msg);
                })
                .build();
    }
}
```
创建配置文件如下：
```yaml
akka {
  actor {
    provider = "remote"
    deployment {
      /toCreateActor {
        remote = "akka.tcp://main2@127.0.0.1:2552"
      }
    }
  }
  remote {
    netty.tcp {
      hostname = "127.0.0.1"
      port = 2553
    }
  }
}
```
其中`toCreateActor`就是指定远端要启动的Actor的别名，在本地的ActorSystem靠这个别名去启动。注意指定provider为remote！

```java
public class Main3 {

    public static void main(String[] args) {
        Config config = ConfigFactory.load("create_remote.conf");
        // Create an Akka system
        ActorSystem system = ActorSystem.create("main3", config);
        ActorRef actor = system.actorOf(Props.create(ToCreateRemoteActor.class), "toCreateActor");
        actor.tell("I'm created!", ActorRef.noSender());
    }

}
```
可以看到这里就尝试去创建一个名字叫`toCreateActor`的Actor，而这个名字在配置文件中定义了是远端的，Akka会自动尝试去远端创建。
启动一下，看到Main3的日志：
```
[INFO] [10/26/2018 15:25:42.794] [main] [akka.remote.Remoting] Starting remoting
[INFO] [10/26/2018 15:25:43.364] [main] [akka.remote.Remoting] Remoting started; listening on addresses :[akka.tcp://main3@127.0.0.1:2553]
[INFO] [10/26/2018 15:25:43.365] [main] [akka.remote.Remoting] Remoting now listens on addresses: [akka.tcp://main3@127.0.0.1:2553]
```
检查Main2的日志，会发现远程Actor创建的信息：
```
[INFO] [10/26/2018 15:25:43.774] [main2-akka.actor.default-dispatcher-17] [akka://main2/remote/akka.tcp/main3@127.0.0.1:2553/user/toCreateActor] ToCreateRemoteActor is starting
[INFO] [10/26/2018 15:25:43.775] [main2-akka.actor.default-dispatcher-16] [akka://main2/remote/akka.tcp/main3@127.0.0.1:2553/user/toCreateActor] Msg received: I'm created!
```
到这，一个远端的Actor就被创建出来了。
不过，事情就这样结束了吗？思考一个问题：***查询这种远端创建的Actor，跟之前那个远端自己起来的Actor，方式一样吗？***
参考Main2，我们再写一个Main4来尝试查询并发送消息。那有一个问题，toCreateActor的地址到底该选哪个？按理说，应该是`akka.tcp://main2@127.0.0.1:2552/user/toCreateActor`。带着问题，我们试试看
```java
public class Main4 {

    public static void main(String[] args) {
        Config config = ConfigFactory.parseString(
                "akka.remote.netty.tcp.port=" + 0)
                .withFallback(ConfigFactory.load("remote.conf"));
        // Create an Akka system
        ActorSystem system = ActorSystem.create("main4", config);

        // Find remote actor
        ActorSelection toFind = system.actorSelection("akka.tcp://main2@127.0.0.1:2552/user/toCreateActor");
        toFind.tell("I'm alive!", ActorRef.noSender());
    }
}
```
Main2中，会打印
```
[INFO] [10/26/2018 15:42:25.508] [main2-akka.actor.default-dispatcher-16] [akka://main2/user/toCreateActor] Message [java.lang.String] without sender to Actor[akka://main2/user/toCreateActor] was not delivered. [2] dead letters encountered. If this is not an expected behavior, then [Actor[akka://main2/user/toCreateActor]] may have terminated unexpectedly, This logging can be turned off or adjusted with configuration settings 'akka.log-dead-letters' and 'akka.log-dead-letters-during-shutdown'.
```
失败了。。。。。。
仔细看，Main2里面创建出来的Actor的Path是
`akka://main2/remote/akka.tcp/main3@127.0.0.1:2553/user/toCreateActor`
而远端自己起的Actor地址是：
`akka://sys/user/toFind`
所以，正确的Path应该是`akka.tcp/main3@127.0.0.1:2553/user/toCreateActor`
修改后测试一下，会发现Main2中打印
```
[INFO] [10/26/2018 15:25:58.615] [main2-akka.actor.default-dispatcher-17] [akka://main2/remote/akka.tcp/main3@127.0.0.1:2553/user/toCreateActor] Msg received: I'm alive!
```

所以，可以得出一个看上去不是很合理的结论：
虽然RemoteActor是创建在远程机器上，但如果想要查询它，还得向创建者发请求。

## Artery
Artert是Akka为新版的remote包起的代号。目前是共存状态，但被标记为[may change](https://doc.akka.io/docs/akka/current/common/may-change.html)状态，仅UDP模式可以用于生产。

配置与原来的remote略有不同
```yarml
akka {
  actor {
    provider = remote
  }
  remote {
    artery {
      enabled = on
      transport = aeron-udp
      canonical.hostname = "127.0.0.1"
      canonical.port = 25520
    }
  }
}
```
与原先相比，多了一个enabled选项控制artery是否启动。
相比原来的remote，Artery的变化主要集中在高吞吐、低延迟场景下提高性能上，包括用Akka Streams TCP/TLS替代了原来的Netty TCP，并新增了基于[Aeron](https://github.com/real-logic/Aeron)的UDP协议模式，以及对直接写`java.nio.ByteBuffer`的支持，大小消息分channel发等等。


## 其他介绍
在具体使用中，还需要考虑序列化、路由、安全，而这些Akka都提供了。且看下回分解。