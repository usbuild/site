+++
draft = false
tags = ["jit", "luajit"]
topics = ["jit"]
description = ""
title = "实现一个带 JIT 的计算器"
date = "2018-11-01T20:10:38+08:00"
+++

所谓的 JIT，全称为Just In Time，一般搜索出来的结果会是“精益生产”，但是在软件行业，这个词一般是指，在程序运行过程中，动态生成代码来加快运行速度。这个代码，通常是机器代码。JIT往往和脚本语言联系起来，如Lua、Python等，这些语言在解释运行的时候会将某些热门代码动态转换成机器代码执行。

JIT的基本工作流程：

1. 监测热代码，动态编译本身是有一定开销的，如果错误的编译了不常用的代码会使得编译的成本比运行的成本还要高。因此必须对某些非常常用的代码JIT。其中的一个策略是，按照代码块（lexical scope）来作为jit的单元。如果对于IF/ELSE中的两个分支调用都很频繁，那么JIT会倾向于编译成两个单元而不是单独的一个。

2. 将字节码转换成IR（intermediate representation），这个步骤是可选的，但是大部分脚本语言会采用这个步骤。IR的目的，一般是为了优化。现在由于LLVM组织方式的盛行，很多JIT实现会将字节码转换成LLVM 的IR，因此接下来的步骤就会交给LLVM了，极大地减少了后续的操作。

3. IR优化。如果是LLVM IR的话，这个步骤会交给库来操作，不用语言设计者关心。而如果是自行实现的IR的话，则需要自己来做。这里的优化一般都是常用的编译器优化手段，如死代码消除、unfold等。比如在LuaJIT中，自己实现的IR是一个SSA（静态单赋值），即所有的变量都不会复用，而是直接生成新的变量，这样只需要便利图便可以消除掉所有的无用语句

4. IR转换到机器代码。这一步有的程序会分为两步，一是先转成ASM，然后由工具将ASM转换成机器代码。在LuaJIT1.x版本中，是这样实现的，先手写ASM，然后由DynASM工具来将这些ASM转化成可执行代码。在后面的LuaJIT2.x版本中，这个步骤简化成一部，直接将IR翻译成机器代码。

5. 在字节码处标明，下面的代码已经被JIT了，因此当下次执行的时候会直接执行机器代码而不是字节码。

JIT的技术实现由很多种，有的会省略其中的某些步骤。比如说直接从字节码到机器代码。现在大部分的实现其实是基于LLVM的，将字节码转换成LLVM IR之后就可以完成，提升了开发和运行效率。在LLVM之前，甚至有的语言会转换成C代码，然后调用gcc编译器来进行编译，也不失为一种比较好的解决方案，比如说 ruby [mjit](https://blog.heroku.com/ruby-mjit)。

下面，我将介绍一个JIT的练手项目：实现一个计算器。
输入 a + 1, 1 输出2，即a、b、c是形参，后面的是参数内容。目的是将前面的那个表达式编译成机器代码来执行。这里不考虑错误处理、浮点数等运算。

这里是设计过程：

输入的中缀表达式改成后缀表达式，这个大学课程都学过了，不在赘述。
然后设计字节码，这里我们设计如下的字节码：


| 操作 | 解释 |
|---|---|
|PUSHC val | 将 val这个常量push到栈中|
|PUSHV idx| 将index为idx的变量push到栈中|
|ADD | 加操作|
|SUB | 减操作|
| MUL| 乘操作|
| DIV | 除操作 |
|RET | 返回栈中的唯一一个元素|

其实就是模拟后缀表达式的取值流程。接下来分为两块：
实现虚拟机。不断读取字节码，然后一个大的select分支处理各个字节码。这部分的逻辑很简单，不再赘述。
实现JIT编译。

重点介绍字节码到机器代码的过程。考虑到运行效率，字节码中的栈我们并不对应到现有的汇编中的栈(即push、pop这些语句)，我们直接采用寄存器的方式来实现栈，即一个寄存器对应一个栈元素。
因此我们定义
```
uchar reg_stacki[] = {RID_RBX, RID_RCX, RID_RDI, RID_RSI, RID_R8,
                      RID_R9,  RID_R10, RID_R11, RID_R11, RID_R12,
                      RID_R13, RID_R14, RID_R15};
```
这里的 `RID_` 开头的就是一个 int，具体可以参考 [https://wiki.osdev.org/CPU_Registers_x86-64](https://wiki.osdev.org/CPU_Registers_x86-64)。然后也是大的`switch`。下面是部分实例
```
case PUSHV:
    ++bcp;
    int offset = (*bcp + 1) * -8;
    cp = bin_mr(cp, 0x8B, reg_stacki[sp], RID_RBP, offset, 0);
    sp++;
    break;
case PUSHC:
    ++bcp;
    cp = movq_ir(cp, *bcp, reg_stacki[sp]);
    sp++;
    break;
case ADD:
    cp = bin_rr(cp, 0x01, reg_stacki[sp - 1], reg_stacki[sp - 2], 0);
    sp--;
    break;
```

至于如何将汇编转换成机器代码，这里不在赘述，网上资料很多，比如说 [https://blog.csdn.net/Apollon_krj/article/details/77508073](https://blog.csdn.net/Apollon_krj/article/details/77508073)。

当我们将机器代码写入一块内存之后，要怎么样运行呢？Linux 提供了 mmap 方法，允许我们分配一块可执行的内存，
```
void *ptr = mmap(0, CODE_SIZE, PROT_READ | PROT_WRITE | PROT_EXEC, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
jitcompile(bc, ptr);
MyFunc f = ptr;
int ret = f();
free(bc);
munmap(ptr, CODE_SIZE);
```

通过 `PROT_EXEC`选项，这块内存便可以执行了，只要将机器代码写入到这里，然后将首条指令的指针转换成函数指针便可以调用了。

完整的代码我放在这里[https://gist.github.com/usbuild/b2d0fccf11afcbe8f6878007626865c2](https://gist.github.com/usbuild/b2d0fccf11afcbe8f6878007626865c2)了。需要注意的是，为了
便于调试，这份代码同时生产了一份`.s`文件，里面的内容是汇编指令，可以对照查看。

下面是性能测试的结果：
```
------------------------------------------------------
Benchmark               Time           CPU Iterations
------------------------------------------------------
JIT_test               18 ns         18 ns   38020877
INTERPRET_test        212 ns        212 ns    3307765
```

可以看出，相对于解释执行，JIT 后的运行效率在10倍以上。而且这还是没有做任何优化的结果。可见，当正确应用JIT的时候，性能提升是很可观的。
