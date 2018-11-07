+++
draft = false
tags = ["c++", "coroutine", "造轮子"]
topics = ["coroutine"]
description = ""
title = "[造轮子] 又一个 c++ coroutine 的实现"
date = "2018-11-07T10:10:00+08:00"
+++

[Coroutine](https://en.wikipedia.org/wiki/Coroutine) (又称协程)目前已经是一个比较热门和时髦的概念。现代的编程语言很多都已经从
语言层面对这一概念进行了支持，甚至有些语言将其作为主打的特性，比如说 Golang 。本文就将简单介绍如何在 C++ 中实现一个协程。

## 协程的定义与分类
根据维基百科，协程被定义如下

> Coroutines are computer-program components that generalize subroutines for non-preemptive multitasking, by allowing multiple entry points for suspending and resuming execution at certain locations. Coroutines are well-suited for implementing familiar program components such as cooperative tasks, exceptions, event loops, iterators, infinite lists and pipes.

用中文说就是 协程是一个子程序，只不过这个子程序可以被暂停和继续执行。 传统意义上的同步和异步程序是这样的：要么必须等待函数执行完毕返回；要么提供一个回调，当函数执行完毕之后会调用这个回调。但是协程提供了另一个
可能，可以在函数执行一半的时候返回，当需要的时候还能在返回处继续执行。

从分类上来说，协程分为两种，对称与非对称。所谓非对称协程是指协程之间存在着调用者和被调用者的关系。比如说在 lua 中，一个 coroutine 的结束就意味着另一个 coroutine 中`coroutine.resume` 的返回。但是对于对称
协程而言，协程之间是不存在从属的关系的，比如说 golang 中的`go`关键字，两个协程同时执行，其运行关系很类似于操作系统中的*线程*。

本文不讨论对称协程的实现，单纯地在 C++ 中实现一个类似 Lua 中的协程接口。

## 前置知识
考虑到协程要允许函数在执行的时候中断并重新开始，这很容易使我们想到两个标准C的接口， [setjmp, longjmp](http://man7.org/linux/man-pages/man3/setjmp.3.html)。这两个函数一般用作异常的处理。像在 Lua 中，
一个 `pcall` 其实相当于调用了 `setjmp`，而 `error` 调用的是 `longjmp`。 `setjmp`的作用是保存当前的运行环境，所谓运行环境就是局部变量，所谓局部变量在底层汇编也就是栈和寄存器的内容，所谓栈在 x86_64 
中也就是 `bp` 和 `sp` 指针，说到底还是寄存器。因此`setjmp` 要保存的其实就是寄存器的内容。同样`longjmp`所实现的跳转也就是将寄存器恢复出来。并没有什么魔法黑科技。

下面来看看`setjmp`的实现(来自[musl libc](https://git.musl-libc.org/cgit/musl/tree/src/setjmp/x86_64/setjmp.s))
```
setjmp:
    mov %rbx,(%rdi)         /* rdi is jmp_buf, move registers onto it */
    mov %rbp,8(%rdi)
    mov %r12,16(%rdi)
    mov %r13,24(%rdi)
    mov %r14,32(%rdi)
    mov %r15,40(%rdi)
    lea 8(%rsp),%rdx        /* this is our rsp WITHOUT current ret addr */
    mov %rdx,48(%rdi)
    mov (%rsp),%rdx         /* save return addr ptr for new rip */
    mov %rdx,56(%rdi)
    xor %rax,%rax           /* always return 0 */
    ret
```
可以看出主要保存了以下的寄存器`rbx`, `rbp`, `r12`, `r13`, `r14`, `r15`，然后是`rsp`。最后是`rip`，当然这个`rip`是函数调用前的下一条，也就是栈顶上的那个元素。

为什么会选择保存这些寄存器？因为这些寄存器（当然除了 `rip` 外）都是跨 [function call](http://www.logix.cz/michal/devel/amd64-regs/) 保留的，也就是当使用`call`的时候，
这些寄存器的值会被保留到调用的函数中。因此必须要保存这些变量，这其实就是所谓的 Context 。其他常用的寄存器会由编译器自动处理，因此保存下来是没有意义的。

同样，`longjmp` 只是将这些 `mov` 操作反过来。但是由于没法直接修改 `rip`，`longjmp`的代码最后一行是`jmp` 。

PS: 这里面实现的 `setjmp` 其实效率并不够高，`libunwind` 中有更快的实现方案，只需要保存`rsp`和`rip`就可以，其采用`dwarf`中定义的栈回溯方式来回复其他变量，因此`setjmp`
的效率会比较高，而`longjmp`的效率则比较低

## 协程库接口设计
可以仿照[Lua](https://www.lua.org/pil/9.1.html) 中的设计。其中最核心的接口就是 `resume`和`yield`。这两个接口其实就是类似于上面的`setjmp`和`longjmp`的结合体。都是
先保存当前的运行环境，然后 jump 到目标。只不过一个是 jump 到协程里面，一个是从协程里面跳出到外面。互相跳的关系。

### context环境
其实就一行
```
typedef void *co_jmp_buf[8]; /* rip, rsp, rbp, rbx, r12, r13, r14, r15 */
```
这个与 `setjmp` 保存的东西是完全一致的。

### jump 的实现
由于`resume`和`yield`的基础操作都是 jump， 也就是从一个 context 跳转到另一个 context，因此，下面就是`co_jump`的实现:
```
static inline void co_jump(co_jmp_buf from, co_jmp_buf to) {
    __asm__ __volatile__("leaq 1f(%%rip), %%rax\n\t"
                         "movq %%rax, (%0)\n\t"
                         "movq %%rsp, 8(%0)\n\t"
                         "movq %%rbp, 16(%0)\n\t"
                         "movq %%rbx, 24(%0)\n\t"
                         "movq %%r12, 32(%0)\n\t"
                         "movq %%r13, 40(%0)\n\t"
                         "movq %%r14, 48(%0)\n\t"
                         "movq %%r15, 56(%0)\n\t"
                         "movq 56(%1), %%r15\n\t"
                         "movq 48(%1), %%r14\n\t"
                         "movq 40(%1), %%r13\n\t"
                         "movq 32(%1), %%r12\n\t"
                         "movq 24(%1), %%rbx\n\t"
                         "movq 16(%1), %%rbp\n\t"
                         "movq 8(%1), %%rsp\n\t"
                         "jmpq *(%1)\n"
                         "1:\n"
                         : "+S"(from), "+D"(to)
                         :
                         : "rax", "rcx", "rdx", "r8", "r9", "r10", "r11", "memory", "cc");
}
```
其中, `from`会用来存储当前的 context 以便下次 jump 回来。而 `to` 则是需要跳转的目标 context。下面对这些代码进行解释

1. `leaq 1f(%%rip), %%rax` 这里是要保存当前的`ip`到 `rax`，但是由于下次跳转不能直接到当前的`ip`，否则就死循环了。因此加了一个`1f`，这玩意儿叫`fb label`，具体
解释可以看[这里](https://docs.oracle.com/cd/E19120-01/open.solaris/817-5477/esqaq/index.html)。这里相当于存储了`1:` label 的地址。
2. 接下来就是存储当前的各种寄存器，和上面的`setjmp` 类似，不表
3. 然后将目标环境的寄存器恢复，和`longjmp`类似
4. 最后直接 `jmp` 过去, 也就是目标`ip`所指的地址。

### 创建 coroutine
有了`co_jump`之后，还需要一个初始化的`routine`，毕竟当我们启动协程的时候，目标的 context 不能是空的，得有一定的内容，其中最核心的就是启动函数。

coroutine 是一个独立的执行单元，需要一个独立的栈，因此我们需要分配一块内存，一般为`2M`，另外由于栈的地址是从高到低的，也就是说需要将分配内存
的 `top` 作为 `rsp`的初始化。
```
stack_ = malloc(CO_STACK_SIZE);
sp_ = (char *)(stack_) + CO_STACK_SIZE;
regs[1] = sp_; // rsp = sp_
```

对于 `rip`的值，其应该指向一个入口函数，这个函数不能直接是传入的入口函数，毕竟我们希望更灵活一点，可以更加精确地控制传参等功能。所以这里做了一些调整
```
regs[0] = (void *)(co_wrap_main); // rip = co_wrap_main;
regs[4] = reinterpret_cast<void *>(+[](Coroutine *self) { // r12 = 我们的入口函数
        // do with self
    });
regs[5] = this; // r13 其实是 Coroutine 的 this 指针
```
为了将 `this` 指针传入到 `r12`的入口函数中，`co_wrap_main`需要这样编写
```
static void co_wrap_main(void) {
    __asm__ __volatile__("\tmovq %r13, %rdi\n" // %rdi is the first argument
                         "\tjmpq *%r12\n");
}
```
其中 `rdi` 是 `amd64` 架构下，第一个形参的寄存器。注意第二句，由于栈之类的已经保存了，因此不能使用`call`指令，而直接使用`jmp`，从而避免修改了`rsp`。

以上就是最核心的内容，有了初始化操作和`co_jump`，就可以很自然地去实现`yield`和`resume`了。这里就不再详细介绍。

### 异常处理
上述的设计并没有考虑到异常。如果一个协程并没有完全执行完而是在协程函数`return`之前就已经终止了，按理说在这个函数中的局部变量应该被析构。但是由于我们直接修改了寄存器，
并没有调用这些析构函数，因此是有问题的。

好在我们可以借用 C++ 的异常。这里可以在 coroutine 销毁时，进入到目标的栈，然后强制抛出一个异常，再到最外层进行补货。接下来再销毁 coroutine 的栈即可。
```
Coroutine::~Coroutine() {
    if (status_ == Status::SUSPEND) {
        force_unwind_ = true; //先标记一下，说明要销毁栈了
        resume(NULL); // 进入到目标的执行栈
    }
    free(stack_);
}

// 这是统一入口函数
regs[4] = reinterpret_cast<void *>(+[](Coroutine *self) {
        try {
            self->yield_arg_ = self->start_routine_(self->resume_arg_);

        } catch (const ForceUnwind &) {
            // 最外层包装了一个 try ，专门用来捕获 ForceUnwind 异常
        }
        self->status_ = Status::EXIT;
    });

void *Coroutine::yield(void *ret) {
    yield_arg_ = ret;
    co_jmp_buf target;
    memcpy(target, saved_ctx_, sizeof(target));
    co_jump(saved_ctx_, target);
    if (force_unwind_) { // 从 yield 处恢复，这里其实是上面 resume 的下一句，立马抛出异常
        throw ForceUnwind{};
    }
    return resume_arg_;
}

```
上面的实现会有一个问题，即如果用户使用`try{}catch(...){}`之类的包住了`yield`，那么`ForceUnwind`异常就没法被最外层的程序捕获，会导致出现问题。目前并没有良好的解决方案。

以上代码可以查看 [https://gist.github.com/usbuild/ba21ff0079264260a222085e45615a71](https://gist.github.com/usbuild/ba21ff0079264260a222085e45615a71)

## 其他选择
当然，这里实现的协程库并不能作为生产环境使用，现在已经有很多相关的第三方库可供使用，很多基于[ucontext](http://pubs.opengroup.org/onlinepubs/7908799/xsh/ucontext.h.html)。
此外，像[Boost.Coroutine2](https://www.boost.org/doc/libs/1_68_0/libs/coroutine2/doc/html/index.html) 也已经比较成熟，也提供了一些更为高层的解决方案。如果要在生产中使用，也
应该优先选择这些库。