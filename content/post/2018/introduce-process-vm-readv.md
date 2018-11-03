+++
draft = false
tags = ["linux", "IPC"]
topics = ["IPC"]
description = ""
title = "process_vm_readv: 一种新的IPC解决方案"
date = "2018-11-03T17:17:17+08:00"
+++

Linux 3.2 引入了两个新的接口 [process_vm_ready](http://man7.org/linux/man-pages/man2/process_vm_readv.2.html) 和 [process_vm_writev](https://linux.die.net/man/2/process_vm_writev)。这两个函数的功能非常直观。

## 接口介绍
下面是这两个接口的原型定义，其并不是 POSIX 标准，因此只能在 Linux 下使用。
```
#include <sys/uio.h>

ssize_t process_vm_readv(pid_t pid,
                         const struct iovec *local_iov,
                         unsigned long liovcnt,
                         const struct iovec *remote_iov,
                         unsigned long riovcnt,
                         unsigned long flags);

ssize_t process_vm_writev(pid_t pid,
                          const struct iovec *local_iov,
                          unsigned long liovcnt,
                          const struct iovec *remote_iov,
                          unsigned long riovcnt,
                          unsigned long flags);
```
`process_vm_readv`的作用，是将某个目标进程的一块内存区域读取到当前的进程，类似于生产一个 `core`，但是其控制粒度要更加精确，并且可以以编程的方式分析读取出来的内存。同样，`process_vm_writev` 的作用是反过来的，就是将当前进程
的一块内存写入到目标进程。 这两个接口是系统调用，直接在用户地址空间进行的拷贝，无需通过内核空间中转，因此效率非常之高。我能想到的有以下几个应用场景：

### 应用场景
1. 提供进程的查探接口
之前我们要查看线上的进程运行状况，会有几种解决方案。一是编写接口，如telnet、http之类；这些接口的编写往往有一定的工作量并且在程序无响应时没法使用，一般作为高层逻辑的查看接口；比如说看游戏占用内存啊、服务器人数之类。另一个是通过
`gcore` 或 `gdb` 来查看，这一般用来做很底层的逻辑分析，分析`core`文件需要一定的基础，并且无法常态化运行，你总不能程序每隔30s生产一份 `core` 文件然后分析这个文件从而生成统计数据吧，既不优雅又对磁盘又较大的开销。

这个时候, `process_vm_readv` 的作用就显现了，只需要程序在运行时将某些关键数据结构的地址写入到文件，便可以编写一个探针程序来读取这个地址内容，然后分析输出从而可以实现实时的统计结果。由于进程间是隔离的，对主程序没有任何的影响，一旦
探针程序崩溃只需重启即可。甚至可以在部署的时候，一台机器一个探针程序，监控所有的游戏进程并定期汇报。游戏进程无需做任何与外界交流的事情，无需写文件（文件还可能会满）、写网络、写消息队列就可以将状态暴露出来，并且是0开销。

2. 提供进程的修改接口
通过`process_vm_writev`我们可以直接修改目标进程的内容了，并且目标程序无需编写相关的代码。这里的典型场景是配置文件的 reload。目前常用的方式是先修改文件然后通知目标重新读取文件，通过新的接口可以直接修改目标进程的内存配置，更加地直观。
同时，由于内存拷贝的原因，当我们需要大量传输数据的时候也能减少系统的响应时间。

3. 作为一种 IPC 方式
现在常用的进程间通信主要就是 unix socket ，其效率相对共享内存来说是比较低的。但是共享内存的配置是相当负责并且容易出错的。而使用新的接口后，实现起来会比较简单。

基本的流程是通过 `sendmsg` 发送 `eventfd` 或 `pipe` 之类的接口将要传输的内容地址等信息发送给目标进程，然后由目标进程来主动读取，读取完了在通知这边准备下一份数据，如此往复。由于没有数据共享，因此也不存在竞争等问题，一对多的情况下
也无需加锁，程序的复杂度比较低。

### 参数介绍
这两个接口有一个很重要的参数类型是 `iovec`，这个我们在`writev`等接口中有接触过，其表示的是多块内存。比如说当网络发包的时候，用户程序可能是一个一个包过来，表示就是链表。如果使用`write`调用则每个节点都需要调用一次，如果使用`writev`
的话只需要一次系统调用就可以完成，提升了效率。

### 代码示例
这里是一个可以运行的`process_vm_readv`的代码示例 [https://gist.github.com/usbuild/5af20dcd9bb954b7deda987ed79eda4a](https://gist.github.com/usbuild/5af20dcd9bb954b7deda987ed79eda4a)。其通过 `socket` 来传输事件，通过
内存来分享数据。