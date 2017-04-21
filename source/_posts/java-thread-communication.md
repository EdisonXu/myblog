---
title: JAVA线程间通信的几种方式
date: 2017-03-02 21:10:44
tags: 多线程
---
> 今天在群里面看到一个很有意思的面试题：
“编写两个线程，一个线程打印1~25，另一个线程打印字母A~Z，打印顺序为12A34B56C……5152Z，要求使用线程间的通信。”
这是一道非常好的面试题，非常能彰显被面者关于多线程的功力，一下子就勾起了我的兴趣。这里抛砖引玉，给出7种想到的解法。

## 1. 第一种解法，包含多种小的不同实现方式，但一个共同点就是**靠一个共享变量来做控制**；
  ### a. 利用最基本的`synchronized`、`notify`、`wait`：
  ```java
  public class MethodOne {

    private final ThreadToGo threadToGo = new ThreadToGo();

    public Runnable newThreadOne() {
        final String[] inputArr = Helper.buildNoArr(52);
        return new Runnable() {
            private String[] arr = inputArr;
            public void run() {
                try {
                    for (int i = 0; i < arr.length; i=i+2) {
                        synchronized (threadToGo) {
                            while (threadToGo.value == 2)
                                threadToGo.wait();
                            Helper.print(arr[i], arr[i + 1]);
                            threadToGo.value = 2;
                            threadToGo.notify();
                        }
                    }
                } catch (InterruptedException e) {
                    System.out.println("Oops...");
                }
            }
        };
    }

    public Runnable newThreadTwo() {
        final String[] inputArr = Helper.buildCharArr(26);
        return new Runnable() {
            private String[] arr = inputArr;

            public void run() {
                try {
                    for (int i = 0; i < arr.length; i++) {
                        synchronized (threadToGo) {
                            while (threadToGo.value == 1)
                                threadToGo.wait();
                            Helper.print(arr[i]);
                            threadToGo.value = 1;
                            threadToGo.notify();
                        }
                    }
                } catch (InterruptedException e) {
                    System.out.println("Oops...");
                }
            }
        };
    }

    class ThreadToGo {
        int value = 1;
    }

    public static void main(String args[]) throws InterruptedException {
        MethodOne one = new MethodOne();
        Helper.instance.run(one.newThreadOne());
        Helper.instance.run(one.newThreadTwo());
        Helper.instance.shutdown();
    }
}
```

  ### b. 利用`Lock`和`Condition`：
```java
public class MethodTwo {

    private Lock lock = new ReentrantLock(true);
    private Condition condition = lock.newCondition();
    private final ThreadToGo threadToGo = new ThreadToGo();

    public Runnable newThreadOne() {
        final String[] inputArr = Helper.buildNoArr(52);
        return new Runnable() {
            private String[] arr = inputArr;
            public void run() {
                for (int i = 0; i < arr.length; i=i+2) {
                    try {
                        lock.lock();
                        while(threadToGo.value == 2)
                            condition.await();
                        Helper.print(arr[i], arr[i + 1]);
                        threadToGo.value = 2;
                        condition.signal();
                    } catch (InterruptedException e) {
                        e.printStackTrace();
                    } finally {
                        lock.unlock();
                    }
                }
            }
        };
    }

    public Runnable newThreadTwo() {
        final String[] inputArr = Helper.buildCharArr(26);
        return new Runnable() {
            private String[] arr = inputArr;

            public void run() {
                for (int i = 0; i < arr.length; i++) {
                    try {
                        lock.lock();
                        while(threadToGo.value == 1)
                            condition.await();
                        Helper.print(arr[i]);
                        threadToGo.value = 1;
                        condition.signal();
                    } catch (Exception e) {
                        e.printStackTrace();
                    } finally {
                        lock.unlock();
                    }
                }
            }
        };
    }

    class ThreadToGo {
        int value = 1;
    }

    public static void main(String args[]) throws InterruptedException {
        MethodTwo two = new MethodTwo();
        Helper.instance.run(two.newThreadOne());
        Helper.instance.run(two.newThreadTwo());
        Helper.instance.shutdown();
    }
}
```

  ### c. 利用`volatile`：
  `volatile`修饰的变量值直接存在main memory里面，子线程对该变量的读写直接写入main memory，而不是像其它变量一样在local thread里面产生一份copy。`volatile`能保证所修饰的变量对于多个线程可见性，即只要被修改，其它线程读到的一定是最新的值。
```java
public class MethodThree {

    private volatile ThreadToGo threadToGo = new ThreadToGo();

    class ThreadToGo {
        int value = 1;
    }

    public Runnable newThreadOne() {
        final String[] inputArr = Helper.buildNoArr(52);
        return new Runnable() {
            private String[] arr = inputArr;
            public void run() {
                for (int i = 0; i < arr.length; i=i+2) {
                    while(threadToGo.value==2){}
                    Helper.print(arr[i], arr[i + 1]);
                    threadToGo.value=2;
                }
            }
        };
    }

    public Runnable newThreadTwo() {
        final String[] inputArr = Helper.buildCharArr(26);
        return new Runnable() {
            private String[] arr = inputArr;

            public void run() {
                for (int i = 0; i < arr.length; i++) {
                    while(threadToGo.value==1){}
                    Helper.print(arr[i]);
                    threadToGo.value=1;
                }
            }
        };
    }

    public static void main(String args[]) throws InterruptedException {
        MethodThree three = new MethodThree();
        Helper.instance.run(three.newThreadOne());
        Helper.instance.run(three.newThreadTwo());
        Helper.instance.shutdown();
    }
}
```

  ### d. 利用`AtomicInteger`：
```java
public class MethodFive {

    private AtomicInteger threadToGo = new AtomicInteger(1);

    public Runnable newThreadOne() {
        final String[] inputArr = Helper.buildNoArr(52);
        return new Runnable() {
            private String[] arr = inputArr;
            public void run() {
                for (int i = 0; i < arr.length; i=i+2) {
                    while(threadToGo.get()==2){}
                    Helper.print(arr[i], arr[i + 1]);
                    threadToGo.set(2);
                }
            }
        };
    }

    public Runnable newThreadTwo() {
        final String[] inputArr = Helper.buildCharArr(26);
        return new Runnable() {
            private String[] arr = inputArr;

            public void run() {
                for (int i = 0; i < arr.length; i++) {
                    while(threadToGo.get()==1){}
                    Helper.print(arr[i]);
                    threadToGo.set(1);
                }
            }
        };
    }

    public static void main(String args[]) throws InterruptedException {
        MethodFive five = new MethodFive();
        Helper.instance.run(five.newThreadOne());
        Helper.instance.run(five.newThreadTwo());
        Helper.instance.shutdown();
    }
}
```

## 2. 第二种解法，是利用`CyclicBarrier`API；
`CyclicBarrier`可以实现让一组线程在全部到达`Barrier`时(执行`await()`)，再一起同时执行，并且所有线程释放后，还能复用它,即为Cyclic。
`CyclicBarrier`类提供两个构造器：
```java
public CyclicBarrier(int parties, Runnable barrierAction) {
}

public CyclicBarrier(int parties) {
}
```
这里是利用它到达`Barrier`后去执行barrierAction。
```java
public class MethodFour{

      private final CyclicBarrier barrier;
      private final List<String> list;

      public MethodFour() {
          list = Collections.synchronizedList(new ArrayList<String>());
          barrier = new CyclicBarrier(2,newBarrierAction());
      }

      public Runnable newThreadOne() {
          final String[] inputArr = Helper.buildNoArr(52);
          return new Runnable() {
              private String[] arr = inputArr;

              public void run() {
                  for (int i = 0, j=0; i < arr.length; i=i+2,j++) {
                      try {
                          list.add(arr[i]);
                          list.add(arr[i+1]);
                          barrier.await();
                      } catch (InterruptedException | BrokenBarrierException e) {
                          e.printStackTrace();
                      }
                  }
              }
          };
      }

      public Runnable newThreadTwo() {
          final String[] inputArr = Helper.buildCharArr(26);
          return new Runnable() {

              private String[] arr = inputArr;
              public void run() {
                  for (int i = 0; i < arr.length; i++) {
                      try {
                          list.add(arr[i]);
                          barrier.await();
                      } catch (InterruptedException | BrokenBarrierException e) {
                          e.printStackTrace();
                      }
                  }
              }
          };
      }

      private Runnable newBarrierAction(){
          return new Runnable() {
              @Override
              public void run() {
                  Collections.sort(list);
                  list.forEach(c->System.out.print(c));
                  list.clear();
              }
          };
      }

      public static void main(String args[]){
          MethodFour four = new MethodFour();
          Helper.instance.run(four.newThreadOne());
          Helper.instance.run(four.newThreadTwo());
          Helper.instance.shutdown();
      }
}
```
**这里多说一点，这个API其实还是利用`lock`和`condition`，无非是多个线程去争抢`CyclicBarrier`的instance的lock罢了，最终barrierAction执行时，是在抢到`CyclicBarrier`instance的那个线程上执行的。**

## 3. 第三种解法，是利用`PipedInputStream`API；
这里用流在两个线程间通信，但是Java中的Stream是单向的，所以在两个线程中分别建了一个input和output。这显然是一种很搓的方式，不过也算是一种通信方式吧……-\_-T，执行的时候那种速度简直。。。请不要BS我。
```java
public class MethodSix {

    private final PipedInputStream inputStream1;
    private final PipedOutputStream outputStream1;
    private final PipedInputStream inputStream2;
    private final PipedOutputStream outputStream2;
    private final byte[] MSG;

    public MethodSix() {
        inputStream1 = new PipedInputStream();
        outputStream1 = new PipedOutputStream();
        inputStream2 = new PipedInputStream();
        outputStream2 = new PipedOutputStream();
        MSG = "Go".getBytes();

        try {
            inputStream1.connect(outputStream2);
            inputStream2.connect(outputStream1);
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    public void shutdown() throws IOException {
        inputStream1.close();
        inputStream2.close();
        outputStream1.close();
        outputStream2.close();
    }

    public Runnable newThreadOne() {
        final String[] inputArr = Helper.buildNoArr(52);
        return new Runnable() {
            private String[] arr = inputArr;
            private PipedInputStream in = inputStream1;
            private PipedOutputStream out = outputStream1;

            public void run() {
                for (int i = 0; i < arr.length; i=i+2) {
                    Helper.print(arr[i], arr[i + 1]);
                    try {
                        out.write(MSG);
                        byte[] inArr = new byte[2];
                        in.read(inArr);
                        while(true){
                            if("Go".equals(new String(inArr)))
                                break;
                        }
                    } catch (IOException e) {
                        e.printStackTrace();
                    }
                }
            }
        };
    }

    public Runnable newThreadTwo() {
        final String[] inputArr = Helper.buildCharArr(26);
        return new Runnable() {
            private String[] arr = inputArr;
            private PipedInputStream in = inputStream2;
            private PipedOutputStream out = outputStream2;

            public void run() {
                for (int i = 0; i < arr.length; i++) {
                    try {
                        byte[] inArr = new byte[2];
                        in.read(inArr);
                        while(true){
                            if("Go".equals(new String(inArr)))
                                break;
                        }
                        Helper.print(arr[i]);
                        out.write(MSG);
                    } catch (IOException e) {
                        e.printStackTrace();
                    }
                }
            }
        };
    }

    public static void main(String args[]) throws IOException {
        MethodSix six = new MethodSix();
        Helper.instance.run(six.newThreadOne());
        Helper.instance.run(six.newThreadTwo());
        Helper.instance.shutdown();
        six.shutdown();
    }
```

## 4. 第四种解法，是利用`BlockingQueue`；
顺便总结下`BlockingQueue`的一些内容。
`BlockingQueue`定义的常用方法如下:
- `add(Object)`：把Object加到BlockingQueue里，如果BlockingQueue可以容纳，则返回true，否则抛出异常。
- `offer(Object)`：表示如果可能的话，将Object加到BlockingQueue里，即如果BlockingQueue可以容纳，则返回true，否则返回false。
- `put(Object)`：把Object加到BlockingQueue里，如果BlockingQueue没有空间，则调用此方法的线程被阻断直到BlockingQueue里有空间再继续。
- `poll(time)`：获取并删除BlockingQueue里排在首位的对象，若不能立即取出，则可以等time参数规定的时间，取不到时返回null。当不传入time值时，立刻返回。
- `peek()`：立刻获取BlockingQueue里排在首位的对象，但不从队列里删除，如果队列为空，则返回null。
- `take()`：获取并删除BlockingQueue里排在首位的对象，若BlockingQueue为空，阻断进入等待状态直到`BlockingQueue`有新的对象被加入为止。

`BlockingQueue`有四个具体的实现类：
- `ArrayBlockingQueue`：规定大小的`BlockingQueue`，其构造函数必须带一个int参数来指明其大小。其所含的对象是以FIFO（先入先出）顺序排序的。
- `LinkedBlockingQueue`：大小不定的`BlockingQueue`，若其构造函数带一个规定大小的参数，生成的BlockingQueue有大小限制，若不带大小参数，所生成的`BlockingQueue`的大小由`Integer.MAX_VALUE`来决定。其所含的对象是以FIFO顺序排序的。
- `PriorityBlockingQueue`：类似于`LinkedBlockingQueue`,但其所含对象的排序不是FIFO，而是依据对象的自然排序顺序或者是构造函数所带的`Comparator`决定的顺序。
- `SynchronousQueue`：特殊的`BlockingQueue`，对其的操作必须是放和取交替完成的。

这里我用了两种玩法：
- 一种是共享一个queue，根据`peek`和`poll`的不同来实现；
- 第二种是两个queue，利用`take()`会自动阻塞来实现。

```java
public class MethodSeven {

    private final LinkedBlockingQueue<String> queue = new LinkedBlockingQueue<>();

    public Runnable newThreadOne() {
        final String[] inputArr = Helper.buildNoArr(52);
        return new Runnable() {
            private String[] arr = inputArr;
            public void run() {
                for (int i = 0; i < arr.length; i=i+2) {
                    Helper.print(arr[i], arr[i + 1]);
                    queue.offer("TwoToGo");
                    while(!"OneToGo".equals(queue.peek())){}
                    queue.poll();
                }
            }
        };
    }

    public Runnable newThreadTwo() {
        final String[] inputArr = Helper.buildCharArr(26);
        return new Runnable() {
            private String[] arr = inputArr;

            public void run() {
                for (int i = 0; i < arr.length; i++) {
                    while(!"TwoToGo".equals(queue.peek())){}
                    queue.poll();
                    Helper.print(arr[i]);
                    queue.offer("OneToGo");
                }
            }
        };
    }

    private final LinkedBlockingQueue<String> queue1 = new LinkedBlockingQueue<>();
    private final LinkedBlockingQueue<String> queue2 = new LinkedBlockingQueue<>();

    public Runnable newThreadThree() {
        final String[] inputArr = Helper.buildNoArr(52);
        return new Runnable() {
            private String[] arr = inputArr;
            public void run() {
                for (int i = 0; i < arr.length; i=i+2) {
                    Helper.print(arr[i], arr[i + 1]);
                    try {
                        queue2.put("TwoToGo");
                        queue1.take();
                    } catch (InterruptedException e) {
                        e.printStackTrace();
                    }
                }
            }
        };
    }

    public Runnable newThreadFour() {
        final String[] inputArr = Helper.buildCharArr(26);
        return new Runnable() {
            private String[] arr = inputArr;

            public void run() {
                for (int i = 0; i < arr.length; i++) {
                    try {
                        queue2.take();
                        Helper.print(arr[i]);
                        queue1.put("OneToGo");
                    } catch (InterruptedException e) {
                        e.printStackTrace();
                    }
                }
            }
        };
    }

    public static void main(String args[]) throws InterruptedException {
        MethodSeven seven = new MethodSeven();
        Helper.instance.run(seven.newThreadOne());
        Helper.instance.run(seven.newThreadTwo());
        Thread.sleep(2000);
        System.out.println("");
        Helper.instance.run(seven.newThreadThree());
        Helper.instance.run(seven.newThreadFour());
        Helper.instance.shutdown();
    }
```

本文所有代码已上传至GitHub：https://github.com/EdisonXu/POC/tree/master/concurrent-test
