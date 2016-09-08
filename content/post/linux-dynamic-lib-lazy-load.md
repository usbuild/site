+++
date = "2016-09-06T22:08:20+08:00"
description = ""
draft = true
tags = ["Linux", "ELF"]
title = "Linux下动态链接库延迟绑定介绍"
plugins = ["viz"]

+++

<script src="//cdn.bootcss.com/highlight.js/9.6.0/languages/x86asm.min.js"></script>

在编译动态链接库时，为了保证能被正常使用，一般我们会加上-fPIC参数。在使用的动态链接库中的函数时，Linux使用了一种
叫延迟绑定的技术实现运行时的symbol relocation。其中的关键就是GOT(Global Offset Table)和PLT(Procedure linkage Table)。下面就
这一技术的实现简单解释一下。

首先写一个很简单的需要动态链接的程序，如下

```c
//dl_test.c
#include <stdio.h>
int main(int argc, const char *argv[])
{
    puts("1234");
    puts("1234");
    return 0;
}
```

然后使用`gcc`编译并链接: `gcc -g dl_test.c -o dl_test.c`。先别急着运行这个程序，我们使用`objdump`反编译一下看看：

```bash
$ objdump -S dl_test
......
0000000000400506 <main>:
#include <stdio.h>
int main(int argc, const char *argv[])
{
  400506:       55                      push   %rbp
  400507:       48 89 e5                mov    %rsp,%rbp
  40050a:       48 83 ec 10             sub    $0x10,%rsp
  40050e:       89 7d fc                mov    %edi,-0x4(%rbp)
  400511:       48 89 75 f0             mov    %rsi,-0x10(%rbp)
    puts("1234");
  400515:       bf b4 05 40 00          mov    $0x4005b4,%edi
  40051a:       e8 c1 fe ff ff          callq  4003e0 <puts@plt>
    puts("1234");
  40051f:       bf b4 05 40 00          mov    $0x4005b4,%edi
  400524:       e8 b7 fe ff ff          callq  4003e0 <puts@plt>
    return 0;
  400529:       b8 00 00 00 00          mov    $0x0,%eax
}
  40052e:       c9                      leaveq
  40052f:       c3                      retq
......
```
可以看到，在`40051a`和`400524`两处都调用了我们的`puts`函数。但是看后面的注解，`<puts@plt>`表示这并不是`puts`的地址，而是另有目的。
我们使用`gdb`来跟踪一下执行过程：`gdb dl_test`

```
(gdb) l
1	#include <stdio.h>
2	int main(int argc, const char *argv[])
3	{
4	    puts("1234");
5	    puts("1234");
6	    return 0;
7	}
(gdb) b 4
Breakpoint 1 at 0x400515: file dl_test.c, line 4.
(gdb) r
Starting program: /home/zqc/workspace/cpptest/dl_test

Breakpoint 1, main (argc=1, argv=0x7fffffffeb98) at dl_test.c:4
4	    puts("1234");
(gdb)
```

这里设置了一下断点到第一个`puts`的调用出，使用`layout asm`切换成汇编模式:

```x86asm
(gdb) layout asm
   ┌────────────────────────────────────────────────────────────────────────────────────────────┐
B+>│0x400515 <main+15>              mov    $0x4005b4,%edi                                       │
   │0x40051a <main+20>              callq  0x4003e0 <puts@plt>                                  │
   │0x40051f <main+25>              mov    $0x4005b4,%edi                                       │
   │0x400524 <main+30>              callq  0x4003e0 <puts@plt>                                  │
   │0x400529 <main+35>              mov    $0x0,%eax                                            │
   │0x40052e <main+40>              leaveq                                                      │
   │0x40052f <main+41>              retq                                                        │
   │0x400530 <__libc_csu_init>      push   %r15                                                 │
   │0x400532 <__libc_csu_init+2>    mov    %edi,%r15d                                           │
   │0x400535 <__libc_csu_init+5>    push   %r14                                                 │
   │0x400537 <__libc_csu_init+7>    mov    %rsi,%r14                                            │
   │0x40053a <__libc_csu_init+10>   push   %r13                                                 │
   │0x40053c <__libc_csu_init+12>   mov    %rdx,%r13                                            │
   │0x40053f <__libc_csu_init+15>   push   %r12                                                 │
   │0x400541 <__libc_csu_init+17>   lea    0x2001a0(%rip),%r12        # 0x6006e8                │
   │0x400548 <__libc_csu_init+24>   push   %rbp                                                 │
   │0x400549 <__libc_csu_init+25>   lea    0x2001a0(%rip),%rbp        # 0x6006f0                │
   │0x400550 <__libc_csu_init+32>   push   %rbx                                                 │
   │0x400551 <__libc_csu_init+33>   sub    %r12,%rbp                                            │
   └────────────────────────────────────────────────────────────────────────────────────────────┘
child process 8855 In: main                                              Line: 4    PC: 0x400515
```

使用`stepi`或者简写为`si`执行下一条汇编指令。我们一直跟踪到`call`指令中去：

```x86asm
   ┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
  >│0x4003e0 <puts@plt>                     jmpq   *0x20050a(%rip)   # 0x6008f0 <puts@got.plt>              │
   │0x4003e6 <puts@plt+6>                   pushq  $0x0                                                     │
   │0x4003eb <puts@plt+11>                  jmpq   0x4003d0                                                 │
   │0x4003f0 <__libc_start_main@plt>        jmpq   *0x200502(%rip)   # 0x6008f8 <__libc_start_main@got.plt> │
   │0x4003f6 <__libc_start_main@plt+6>      pushq  $0x1                                                     │
   │0x4003fb <__libc_start_main@plt+11>     jmpq   0x4003d0                                                 │
   │0x400400 <__gmon_start__@plt>           jmpq   *0x2004fa(%rip)   # 0x600900 <__gmon_start__@got.plt>    │
   │0x400406 <__gmon_start__@plt+6>         pushq  $0x2                                                     │
   │0x40040b <__gmon_start__@plt+11>        jmpq   0x4003d0                                                 │
   │0x400410 <_start>                       xor    %ebp,%ebp                                                │
   │0x400412 <_start+2>                     mov    %rdx,%r9                                                 │
   │0x400415 <_start+5>                     pop    %rsi                                                     │
   │0x400416 <_start+6>                     mov    %rsp,%rdx                                                │
   │0x400419 <_start+9>                     and    $0xfffffffffffffff0,%rsp                                 │
   │0x40041d <_start+13>                    push   %rax                                                     │
   │0x40041e <_start+14>                    push   %rsp                                                     │
   │0x40041f <_start+15>                    mov    $0x4005a0,%r8                                            │
   │0x400426 <_start+22>                    mov    $0x400530,%rcx                                           │
   │0x40042d <_start+29>                    mov    $0x400506,%rdi                                           │
   └────────────────────────────────────────────────────────────────────────────────────────────────────────┘
child process 9211 In: puts@plt                                                      Line: ??   PC: 0x4003e0
0x00000000004003e0 in puts@plt ()
(gdb)
```
`0x4003e0`是刚刚跳转的地址，也就是`<puts@plt>`，从这个名字中我们可以看出，这个地址是属于`plt`的。先说一下`plt`的作用，`plt`的全称是
过程链接表，意思就是当调用一个动态链接库中的函数时，其访问的是其实是`plt`中的一个过程，这个过程会完成真正的调用。我们分别看下属于`puts`中
`plt`的项目

```x86asm
  >│0x4003e0 <puts@plt>                     jmpq   *0x20050a(%rip)        # 0x6008f0 <puts@got.plt>     │
   │0x4003e6 <puts@plt+6>                   pushq  $0x0                                                 │
   │0x4003eb <puts@plt+11>                  jmpq   0x4003d0                                             │
```
其中 `0x20050a(%rip)` 即 `got`中的地址，在初始情况下，该选项为`plt`项中的下一条指令，所以执行`jmpq   *0x20050a(%rip)` 直接会进入到
下一条指令`pushq`， `pushq $0x0`的目的是把当前在符号(`puts`)在`.rela.plt`中的index。我们可以使用`readelf`指令看下：

```bash
$ readelf -r dl_test

Relocation section '.rela.dyn' at offset 0x348 contains 1 entries:
  Offset          Info           Type           Sym. Value    Sym. Name + Addend
0000006008d0  000300000006 R_X86_64_GLOB_DAT 0000000000000000 __gmon_start__ + 0

Relocation section '.rela.plt' at offset 0x360 contains 3 entries:
  Offset          Info           Type           Sym. Value    Sym. Name + Addend
0000006008f0  000100000007 R_X86_64_JUMP_SLO 0000000000000000 puts + 0
0000006008f8  000200000007 R_X86_64_JUMP_SLO 0000000000000000 __libc_start_main + 0
000000600900  000300000007 R_X86_64_JUMP_SLO 0000000000000000 __gmon_start__ + 0
```
可以看到，`puts`的index为0，第一项，所以这里push的是`$0x0`。同理，下面的`__libc_start_main`就是`$0x1`。 下一行语句是`jmpq   0x4003d0`，这个地址是
固定的，所有的`plt`入口最后一句语句都是这个，这是个通用的过程。
继续`stepi`到jump的位置

```x86asm
  >│0x4003d0                                pushq  0x20050a(%rip)        # 0x6008e0                     │
   │0x4003d6                                jmpq   *0x20050c(%rip)        # 0x6008e8                    │
   │0x4003dc                                nopl   0x0(%rax)                                            │
   │0x4003e0 <puts@plt>                     jmpq   *0x20050a(%rip)        # 0x6008f0 <puts@got.plt>     │
```

发现这个地址就是在`puts@plt`的上面，并且也是为了保证和普通`plt`入口项目大小(`0x10`)，其末尾还用0补齐了(`nopl   0x0(%rax)`)。我们重点看一下前面两句。

`pushq  0x20050a(%rip)        # 0x6008e0`，这里push了一个地址，这个地址是干嘛的？我们使用`gdb`看一下：

```
(gdb) x /16x 0x6008e0
0x6008e0:       0xf7ffe1a8      0x00007fff      0xf7df02b0      0x00007fff
0x6008f0 <puts@got.plt>:        0x004003e6      0x00000000      0xf7a52a50      0x00007fff
0x600900 <__gmon_start__@got.plt>:      0x00400406      0x00000000      0x00000000      0x00000000
0x600910:       0x00000000      0x00000000      0x00000000      0x00000000
```
这个地址其实就是`got`中的一项，并且在所有普通符号`got`的前面。那么目前栈上的元素是：

```
| 0x00007ffff7ffe1a8 |
| 0x0                |
```
接下来到是`jmpq   *0x20050c(%rip)` 这个地址也是在plt上，紧挨着上面push的地址，值为`0x00007ffff7df02b0`，我们可以继续`stepi`进去，也可以
通过`disassemble 0x00007ffff7df02b0`查看。或者，使用`info symbol 0x00007ffff7df02b0`直接查看。

```
(gdb) info symbol 0x00007ffff7df02b0
_dl_runtime_resolve in section .text of /lib64/ld-linux-x86-64.so.2
```
从这里可以看出，这是属于`ld-linux-x86-64.so.2`里面的一个方法。这个so属于`glibc`的一部分，我们可以下载[glibc](ftp://ftp.gnu.org/gnu/glibc)来查看。最终我们找到了这个符号定义文件，
其位置在`sysdeps/x86_64/dl-trampoline.S`，内容如下

```x86asm
 28     .globl _dl_runtime_resolve
 29     .type _dl_runtime_resolve, @function
 30     .align 16
 31     cfi_startproc
 32 _dl_runtime_resolve:
 33     cfi_adjust_cfa_offset(16) # Incorporate PLT
 34     subq $56,%rsp
 35     cfi_adjust_cfa_offset(56)
 36     movq %rax,(%rsp)    # Preserve registers otherwise clobbered.
 37     movq %rcx, 8(%rsp)
 38     movq %rdx, 16(%rsp)
 39     movq %rsi, 24(%rsp)
 40     movq %rdi, 32(%rsp)
 41     movq %r8, 40(%rsp)
 42     movq %r9, 48(%rsp)
 43     movq 64(%rsp), %rsi # Copy args pushed by PLT in register.
 44     movq 56(%rsp), %rdi # %rdi: link_map, %rsi: reloc_index
 45     call _dl_fixup      # Call resolver.
 46     movq %rax, %r11     # Save return value
 47     movq 48(%rsp), %r9  # Get register content back.
 48     movq 40(%rsp), %r8
 49     movq 32(%rsp), %rdi
 50     movq 24(%rsp), %rsi
 51     movq 16(%rsp), %rdx
 52     movq 8(%rsp), %rcx
 53     movq (%rsp), %rax
 54     addq $72, %rsp      # Adjust stack(PLT did 2 pushes)
 55     cfi_adjust_cfa_offset(-72)
 56     jmp *%r11       # Jump to function address.
 57     cfi_endproc
 58     .size _dl_runtime_resolve, .-_dl_runtime_resolve
```
从43行开始是我们的逻辑。43行取出了我们刚刚push的第一个参数，就是`$0x0`，放到`%rsi`中，然后是我们push的第二个参数，`0x00007ffff7ffe1a8`到`%rsi`中。
为什么是这两个寄存器呢？我们`man syscall`一下：

```
       arch/ABI   arg1   arg2   arg3   arg4   arg5   arg6   arg7
       ──────────────────────────────────────────────────────────
       x86_64     rdi    rsi    rdx    r10    r8     r9     -
```
可以看出linux下的函数传参方式， 那么`%rdi`就是参数1，而`%rsi`就是参数2了。接下来是`call _dl_fixup`，这个函数返回值就是指向`puts`存储地址位置的指针了，后面可以看到
代码中将这个指针保存到了`%r11`，然后`jmp *%r11`。完成了一次函数调用，下面我们来看看`_dl_fixup`做了些什么。同样，这个函数也是`gblic`中定义的，位置在`elf/dl-runtime.c`中：

``` c
59 DL_FIXUP_VALUE_TYPE
60 __attribute ((noinline)) ARCH_FIXUP_ATTRIBUTE
61 _dl_fixup (
62 # ifdef ELF_MACHINE_RUNTIME_FIXUP_ARGS
63        ELF_MACHINE_RUNTIME_FIXUP_ARGS,
64 # endif
65        struct link_map *l, ElfW(Word) reloc_arg)
66 {
```
从函数原型我们可以看出，之前`push`的两个参数分别是`link_map`和`reloc_arg`，

``` c
 67   const ElfW(Sym) *const symtab
 68     = (const void *) D_PTR (l, l_info[DT_SYMTAB]);
 69   const char *strtab = (const void *) D_PTR (l, l_info[DT_STRTAB]);
 70 
 71   const PLTREL *const reloc
 72     = (const void *) (D_PTR (l, l_info[DT_JMPREL]) + reloc_offset);
 73   const ElfW(Sym) *sym = &symtab[ELFW(R_SYM) (reloc->r_info)];
 74   void *const rel_addr = (void *)(l->l_addr + reloc->r_offset);
```

这里做了一下转型，那么`symtab`和`strtab`分别是对于`section`的地址，而`reloc_addr`就是我们`got`中的`puts@got.plt`的地址。接下来就是符号解析过程了，
后面可能会有文章来解释这个过程。当找到目标地址后

``` c
//elf/dl-runtime.c
148   return elf_machine_fixup_plt (l, result, reloc, rel_addr, value);
//sysdeps/x86_64/dl-machine.h
205 static inline ElfW(Addr)
206 elf_machine_fixup_plt (struct link_map *map, lookup_t t,
207                const ElfW(Rela) *reloc,
208                ElfW(Addr) *reloc_addr, ElfW(Addr) value)
209 {
210   return *reloc_addr = value;
211 }
```
这里的`value`就是目标函数地址，也就是`puts`的真正地址，代码中设置其到了`puts@got.plt`的位置并返回。

以上就是第一次调用`puts`的过程了，当第二次调用`puts`时，由于`puts@got.plt`已经有了正确的地址，所以
``` x86asm
  >│0x4003e0 <puts@plt>                     jmpq   *0x20050a(%rip)        # 0x6008f0 <puts@got.plt>    │
```
就直接跳转到正确的`puts`位置，完成了函数调用。所以，`linux`下的这种懒绑定方式实现了在不使用符号的时候不解析，而需要使用的时候
只在第一步开销比较大，后面的调用开销无非多了一次跳转和一次寻址操作而已。