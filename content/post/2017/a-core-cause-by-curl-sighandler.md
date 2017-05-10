+++
date = "2017-05-10T15:31:06+08:00"
description = ""
draft = false
tags = []
title = "一个由 libcurl 导致的 core 分析"
topics = []

+++

最近我们的项目有多个core， 使用gdb查看如下：

```
(gdb) info threads
  Id   Target Id         Frame 
  5    Thread 0x7f28943d9700 (LWP 11079) 0x00007f2895cc5c03 in epoll_wait () at ../sysdeps/unix/syscall-template.S:81
  4    Thread 0x7f2895bdc700 (LWP 11076) 0x00007f2895cbcaed in poll () at ../sysdeps/unix/syscall-template.S:81
  3    Thread 0x7f28953db700 (LWP 11077) 0x00007f2895cc5c03 in epoll_wait () at ../sysdeps/unix/syscall-template.S:81
  2    Thread 0x7f2894bda700 (LWP 11078) 0x00007f2895cc5c03 in epoll_wait () at ../sysdeps/unix/syscall-template.S:81
* 1    Thread 0x7f28983af780 (LWP 11036) 0x00007f2895c12067 in __GI_raise (sig=sig@entry=6) at ../nptl/sysdeps/unix/sysv/linux/raise.c:56
```
gameapp启动了4个子线程，就是上面的2345，1是主线程，从LWP编号中也可以看出。从这里可以看到，是主线程挂掉了，bt一下
```
#0  0x00007f2895c12067 in __GI_raise (sig=sig@entry=6) at ../nptl/sysdeps/unix/sysv/linux/raise.c:56
#1  0x00007f2895c13448 in __GI_abort () at abort.c:89
#2  0x00007f2895c0b266 in __assert_fail_base (fmt=0x7f2895d43f18 "%s%s%s:%u: %s%sAssertion `%s' failed.\n%n", assertion=assertion@entry=0x7f2897e30a7e "inMainThread()", 
    file=file@entry=0x7f2897e30a48 "/home/shiwan/publish/engine/src/base/base_context.hpp", line=line@entry=57, 
    function=function@entry=0x7f2897e313c0 <pm::common::BaseContext::assertInThisThread() const::__PRETTY_FUNCTION__> "void pm::common::BaseContext::assertInThisThread() const") at assert.c:92
#3  0x00007f2895c0b312 in __GI___assert_fail (assertion=0x7f2897e30a7e "inMainThread()", file=0x7f2897e30a48 "/home/shiwan/publish/engine/src/base/base_context.hpp", line=57, 
    function=0x7f2897e313c0 <pm::common::BaseContext::assertInThisThread() const::__PRETTY_FUNCTION__> "void pm::common::BaseContext::assertInThisThread() const") at assert.c:101
#4  0x00007f289777b26d in pm::common::BaseContext::assertInThisThread (this=0x7f28998d4250) at /home/shiwan/publish/engine/src/base/base_context.hpp:57
...
#27 0x00007f2896555970 in ?? () from /usr/lib/x86_64-linux-gnu/libstdc++.so.6
#28 0x00007f2896bbe0a4 in start_thread (arg=0x7f2895bdc700) at pthread_create.c:309
#29 0x00007f2895cc562d in clone () at ../sysdeps/unix/sysv/linux/x86_64/clone.S:111
```
从栈顶可以看出，是代码中调用了`assert`失败了。因为我们的多线程模型属于`one loop per thread`模式，跨线程调用必须通过`event loop`来转发，这里的assert就是为了防止跨线程调用了别的线程中实例的方法。所以继续追踪栈看看调用来源。看到栈低

```
#28 0x00007f2896bbe0a4 in start_thread (arg=0x7f2895bdc700) at pthread_create.c:309
#29 0x00007f2895cc562d in clone () at ../sysdeps/unix/sysv/linux/x86_64/clone.S:111
```
WTF?主线程调用不应该是从`main`开始的么？难道别的线程是主线程？
```
(gdb) thread apply all bt  -2                                                                                                                                                                                     

Thread 5 (Thread 0x7f28943d9700 (LWP 11079)):
#10 0x00007f2896bbe0a4 in start_thread (arg=0x7f28943d9700) at pthread_create.c:309
#11 0x00007f2895cc562d in clone () at ../sysdeps/unix/sysv/linux/x86_64/clone.S:111

Thread 4 (Thread 0x7f2895bdc700 (LWP 11076)):
#56 0x00007f2896bbe0a4 in start_thread (arg=0x7f2895bdc700) at pthread_create.c:309
#57 0x00007f2895cc562d in clone () at ../sysdeps/unix/sysv/linux/x86_64/clone.S:111

Thread 3 (Thread 0x7f28953db700 (LWP 11077)):
#10 0x00007f2896bbe0a4 in start_thread (arg=0x7f28953db700) at pthread_create.c:309
#11 0x00007f2895cc562d in clone () at ../sysdeps/unix/sysv/linux/x86_64/clone.S:111

Thread 2 (Thread 0x7f2894bda700 (LWP 11078)):
#10 0x00007f2896bbe0a4 in start_thread (arg=0x7f2894bda700) at pthread_create.c:309
#11 0x00007f2895cc562d in clone () at ../sysdeps/unix/sysv/linux/x86_64/clone.S:111

Thread 1 (Thread 0x7f28983af780 (LWP 11036)):
#28 0x00007f2896bbe0a4 in start_thread (arg=0x7f2895bdc700) at pthread_create.c:309
#29 0x00007f2895cc562d in clone () at ../sysdeps/unix/sysv/linux/x86_64/clone.S:111
```
查看所有线程堆栈可以看到所有线程的启动函数都是`clone`，这是不正常的。所以问题是主线程的堆栈被覆盖了，那是被哪个线程覆盖了呢？继续在主线程下查看
```
(gdb) f 4
#4  0x00007f289777b26d in pm::common::BaseContext::assertInThisThread (this=0x7f28998d4250) at /home/shiwan/publish/engine/src/base/base_context.hpp:57
57          void assertInThisThread() const { assert(inMainThread()); }
(gdb) p /x this->dispatch_thread_id_
$3 = {_M_thread = 0x7f2895bdc700}
```
根据线程的ID可以看出这个堆栈本来是线程4(LWP 11076)的。查看线程4的堆栈如下
```
#0  0x00007f2895cbcaed in poll () at ../sysdeps/unix/syscall-template.S:81                                                                                                                               [38/1614]
#1  0x00007f289339dcc0 in send_dg (ansp2_malloced=0x7f2895bdac08, resplen2=0x7f2895bdac04, anssizp2=0x7f2895bdac00, ansp2=0x7f2895bdac20, anscp=0x7f2895bdac10, gotsomewhere=<synthetic pointer>, 
    v_circuit=<synthetic pointer>, ns=0, terrno=0x7f2895bd95c8, anssizp=0x7f2895bd9700, ansp=0x7f2895bd95b8, buflen2=47, buf2=0x7f2895bd9760 "\vd\001", buflen=47, buf=0x7f2895bd9730 "\344A\001", 
    statp=0x7f2895bdcdb8) at res_send.c:1200
#2  __libc_res_nsend (statp=statp@entry=0x7f2895bdcdb8, buf=buf@entry=0x7f2895bd9730 "\344A\001", buflen=47, buf2=buf2@entry=0x7f2895bd9760 "\vd\001", buflen2=buflen2@entry=47, 
    ans=ans@entry=0x7f2895bda3d0 "\344A\201\200", anssiz=anssiz@entry=2048, ansp=ansp@entry=0x7f2895bdac10, ansp2=ansp2@entry=0x7f2895bdac20, nansp2=0x7f2895bdac00, nansp2@entry=0x7f2897e5f1c0, 
    resplen2=resplen2@entry=0x7f2895bdac04, ansp2_malloced=0x7f2895bdac08, ansp2_malloced@entry=0x7f2895bdb800) at res_send.c:545
#3  0x00007f289339bc0c in __GI___libc_res_nquery (statp=statp@entry=0x7f2895bdcdb8, name=0x7f288002ef50 "x", class=32552, class@entry=1, type=type@entry=62321, 
    answer=answer@entry=0x7f2895bda3d0 "\344A\201\200", anslen=2048, anslen@entry=3, answerp=answerp@entry=0x7f2895bdac10, answerp2=answerp2@entry=0x7f2895bdac20, nanswerp2=nanswerp2@entry=0x7f2895bdac00, 
    resplen2=resplen2@entry=0x7f2895bdac04, answerp2_malloced=answerp2_malloced@entry=0x7f2895bdac08) at res_query.c:227
#4  0x00007f289339c210 in __libc_res_nquerydomain (statp=0x7f2895bdcdb8, statp@entry=0x74007f2895bdcdb8, name=name@entry=0x7f288002ef50 "x", domain=domain@entry=0x0, class=class@entry=1, 
    type=type@entry=62321, answer=answer@entry=0x7f2895bda3d0 "\344A\201\200", anslen=3, anslen@entry=-1751285904, answerp=0x0, answerp@entry=0x7f2895bdb4f0, answerp2=0x0, answerp2@entry=0x7f2895bdb4c0, 
    nanswerp2=0x2d7, nanswerp2@entry=0x7f2895bdac00, resplen2=0x7f2895bdac04, resplen2@entry=0x7f2897e5f045, answerp2_malloced=answerp2_malloced@entry=0x7f2895bdac08) at res_query.c:594
#5  0x00007f289339c7a9 in __GI___libc_res_nsearch (statp=0x74007f2895bdcdb8, name=name@entry=0x7f288002ef50 "x", class=class@entry=1, type=type@entry=62321, answer=answer@entry=0x7f2895bda3d0 "\344A\201\200", 
    anslen=-1751285904, anslen@entry=2048, answerp=answerp@entry=0x7f2895bdac10, answerp2=answerp2@entry=0x7f2895bdac20, nanswerp2=nanswerp2@entry=0x7f2895bdac00, resplen2=resplen2@entry=0x7f2895bdac04, 
    answerp2_malloced=answerp2_malloced@entry=0x7f2895bdac08) at res_query.c:381
#6  0x00007f28935adacb in _nss_dns_gethostbyname4_r (name=0x7f288002ef50 "x", name@entry=0x7f2895f83060 <_IO_2_1_stderr_> "\207(\255", <incomplete sequence \373>, pat=0x7f2895bdb1f8, pat@entry=0xfbad2086, 
    buffer=buffer@entry=0x7f2895bdaca0 "H\025", <incomplete sequence \310>, buflen=buflen@entry=1064, errnop=0x7f2895bdb1e8, errnop@entry=0x7f2895bdb7b0, herrnop=0x7f2895bdb210, herrnop@entry=0x7f2895d42acf, 
    ttlp=ttlp@entry=0x0) at nss_dns/dns-host.c:315
#7  0x00007f2895cb113c in gaih_inet (name=<optimized out>, service=<optimized out>, req=<optimized out>, pai=<optimized out>, naddrs=<optimized out>) at ../sysdeps/posix/getaddrinfo.c:870
#8  0x00007f2895bdb800 in ?? ()
#9  0x00007f289994d1e0 in ?? ()
#10 0x00007f2895bdb49f in ?? ()
.....
#29 0x00007f2897e30a48 in ?? ()
#30 0x0000000000000039 in ?? ()
#31 0x00007f2895c0b312 in __GI___assert_fail (assertion=0x7f2897e30a7e "inMainThread()", 
    file=0x7f2897e313c0 <pm::common::BaseContext::assertInThisThread() const::__PRETTY_FUNCTION__> "void pm::common::BaseContext::assertInThisThread() const", line=2548241344, function=0x7f28998d6280 "")
    at assert.c:101
#32 0x00007f289777b26d in pm::common::BaseContext::assertInThisThread (this=0x7f28998d4250) at /home/shiwan/publish/engine/src/base/base_context.hpp:57
.....
#54 0x00007f289790e56c in std::thread::_Impl<std::_Bind_simple<pm::common::ThreadBase::start()::<lambda()>()> >::_M_run(void) (this=0x7f28998d0e80) at /usr/include/c++/4.9/thread:115
#55 0x00007f2896555970 in ?? () from /usr/lib/x86_64-linux-gnu/libstdc++.so.6
#56 0x00007f2896bbe0a4 in start_thread (arg=0x7f2895bdc700) at pthread_create.c:309
#57 0x00007f2895cc562d in clone () at ../sysdeps/unix/sysv/linux/x86_64/clone.S:111

```

堆栈下面的内容和刚刚在主线程中的堆栈一致，各种变量的值都是一样的。从31号frame往上就不正常了。
```
#29 0x00007f2897e30a48 in ?? ()
#30 0x0000000000000039 in ?? ()
#31 0x00007f2895c0b312 in __GI___assert_fail (assertion=0x7f2897e30a7e "inMainThread()", 
    file=0x7f2897e313c0 <pm::common::BaseContext::assertInThisThread() const::__PRETTY_FUNCTION__> "void pm::common::BaseContext::assertInThisThread() const", line=2548241344, function=0x7f28998d6280 "")
    at assert.c:101
#32 0x00007f289777b26
```

所以出现的情景是子线程4运行过程中，主线程的栈指针`%rsp`被修改到子线程4的栈空间了。由于`%rsp`被破坏，函数返回时，保存的pc就不是原来的返回点，而是线程4的控制流，调用栈就被错误地设置了。在开始debug的时候，我错误的以为由于线程4的栈
被破坏，加上其中一堆"???"，所以没什么参考价值。但是仔细看看栈顶
```
#0  0x00007f2895cbcaed in poll () at ../sysdeps/unix/syscall-template.S:81                                                                                                                               [38/1614]
#1  0x00007f289339dcc0 in send_dg (ansp2_malloced=0x7f2895bdac08, resplen2=0x7f2895bdac04, anssizp2=0x7f2895bdac00, ansp2=0x7f2895bdac20, anscp=0x7f2895bdac10, gotsomewhere=<synthetic pointer>, 
    v_circuit=<synthetic pointer>, ns=0, terrno=0x7f2895bd95c8, anssizp=0x7f2895bd9700, ansp=0x7f2895bd95b8, buflen2=47, buf2=0x7f2895bd9760 "\vd\001", buflen=47, buf=0x7f2895bd9730 "\344A\001", 
    statp=0x7f2895bdcdb8) at res_send.c:1200
#2  __libc_res_nsend (statp=statp@entry=0x7f2895bdcdb8, buf=buf@entry=0x7f2895bd9730 "\344A\001", buflen=47, buf2=buf2@entry=0x7f2895bd9760 "\vd\001", buflen2=buflen2@entry=47, 
    ans=ans@entry=0x7f2895bda3d0 "\344A\201\200", anssiz=anssiz@entry=2048, ansp=ansp@entry=0x7f2895bdac10, ansp2=ansp2@entry=0x7f2895bdac20, nansp2=0x7f2895bdac00, nansp2@entry=0x7f2897e5f1c0, 
    resplen2=resplen2@entry=0x7f2895bdac04, ansp2_malloced=0x7f2895bdac08, ansp2_malloced@entry=0x7f2895bdb800) at res_send.c:545
#3  0x00007f289339bc0c in __GI___libc_res_nquery (statp=statp@entry=0x7f2895bdcdb8, name=0x7f288002ef50 "x", class=32552, class@entry=1, type=type@entry=62321, 
    answer=answer@entry=0x7f2895bda3d0 "\344A\201\200", anslen=2048, anslen@entry=3, answerp=answerp@entry=0x7f2895bdac10, answerp2=answerp2@entry=0x7f2895bdac20, nanswerp2=nanswerp2@entry=0x7f2895bdac00, 
    resplen2=resplen2@entry=0x7f2895bdac04, answerp2_malloced=answerp2_malloced@entry=0x7f2895bdac08) at res_query.c:227
```
线程正在poll，从上一层的调用来看应该是在做DNS查询, gameapp的最后一行log是

```
I0223 15:06:34.988075 11076 http_manager.cpp:237] Adding curl task url: http://pm01.gmsdk.gameyw.netease.com/app/gen_token.json?game_server=20001&game_uid=4212937&lang=zh_cn&nickname=%E4%BA%8E%E5%AE%B6%E6%AD%8C&pid=pm01&platform=android&refer=%2Fsprite.html&sign=e17e1efcf43bfd036e4410e4b1b844b8&time=1487833594&type=1&uid=aebfpu46xuf3q3ag%40ad.netease.win.163.com&vip=1
```

这行log是线程4打出来的，所以可以判定，此时线程4正在做DNS查询，而调用这个这个DNS的正是curl。那一个简单的DNS查询怎么会导致程序挂掉呢？我们来分析一下CURL的源码：

`Curl_resolv_timeout`是curl用于做dns解析的入口，从函数名可以看出这是个支持timeout的DNS解析函数，然而我们操作系统的如`getaddrinfo`，`gethostbyname`之类的函数都是同步阻塞调用，不支持超时参数的啊。仔细看`Curl_resolv_timeout`
的实现发现其使用`SIGALRM`信号的机制来实现在线程阻塞等待时，依然能够在一定时间之后得到通知，从而放弃继续等待的目的。下面是一个简化后的代码

```
static RETSIGTYPE alarmfunc(int sig)
{
  siglongjmp(curl_jmpenv, 1);
  return;
}

int Curl_resolv_timeout()
{
if(sigsetjmp(curl_jmpenv, 1)) {
  failf(data, "name lookup timed out");
  rc = CURLRESOLV_ERROR;
  goto clean_up;
}

keep_sigact = signal(SIGALRM, alarmfunc);
alarm(curlx_sltoui(timeout/1000L));
Curl_resolv(conn, hostname, port, entry);
signal(SIGALRM, keep_sigact);
}

```

通过alarm触发超时，在调用`Curl_resolv`之前设置好jumppoint，一旦alarm触发，调用`alarmfunc`，再`longjump`到jumppoint位置，间接实现了目的。


<b>然而这种做法在多线程情况下是灾难</b>

在多线程情况下，当一个面向进程的信号事件发生时，系统会选择任意一个可以处理该信号的线程来处理。其中SIGALRM正是一个面向进程的信号事件，所以其可能会被其他线程处理。
这个信号被主线程捕捉到了。现在来还原整个事件：

1. 子线程发起设置好alarm，发起DNS请求并等待
2. 由于DNS查询速度比较慢，ALARM信号事件触发
3. 主线程捕捉到这一信号，调用`alarmfunc`
4. `alarmfunc`的作用是`longjump`，所以主线程的执行环境被替换成子线程的执行环境，栈被破坏

解决方案：
通过查看curl代码，发现其还有一种异步dns模式，但是需要使用[c-ares](https://c-ares.haxx.se)库，所以最终引进了这个库，替换掉了原来的使用系统DNS查询方案。
