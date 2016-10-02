+++
date = "2016-09-25T09:13:27+08:00"
description = ""
draft = false
tags = []
title = "浅谈C++中的地址对齐"
topics = []


+++

# 1. 动机

最近在整理C++11中的新增特性，其中有一个[alignas](http://en.cppreference.com/w/cpp/language/alignas)关键字。在学习这个的时候顺便研究了
下C/C++中的字节对齐问题，发现有很多可以探索的地方。

# 2. 什么是地址对齐

参考维基百科的解释：[Data_structure_alignment](https://en.wikipedia.org/wiki/Data_structure_alignment)。所谓地址对齐，即某个地址A满足是n的倍数，其中n是2的幂次方(如1、2、4、8等等)。如果用二进制表示的话，那么
A的末尾至少有<code>log<sub>2</sub>n</code>个0(废话)。当我们说到某个变量是n字节对齐的时候，其意思是指这个变量的地址是对齐的。

# 3. 地址对齐的意义
从我们编写的程序来看，CPU好像可以访问内存中的任意位置；但是实际上CPU往往是按照块为基本单位访问内存的。如果某个变量的起始地址位于某个块的的起始处，则只需较少的次数便能完成读取。
比如在某个CPU中，其每次取内存的大小为8字节，对于一个8字节的long类型变量，如果该变量的地址是8的倍数，那么每次load这个long变量只需要一次操作。如果不是8的倍数则需要两次，影响了效率。
更多的数据测评参考[这里](http://www.ibm.com/developerworks/library/pa-dalign/)

# 4. 自然对齐
为了保证运行效率，编译器在生成可执行程序的时候会对我们使用的变量自动对齐。这个值往往就是变量类型的size或是能被size整除。如char的自然对齐地址为1，而int则是4或8。但是，这也是有上限的。在`C++11`中，
上限为`std::max_align_t`的对齐值，在大多数平台上，这个类型都被定义为`long double`，因为这往往也是最大的标量。当我们定义数组时，如 `TYPE f[10]`，其中第N个元素的地址为`f + sizeof(TYPE) * N`。
如果`TYPE`的对齐值能被`sizeof(TYPE)`整除的话，则能保证只要数组开始地址时对齐的，那么所有元素都是对齐的。

# 4. 变量的内存对齐控制

GCC有一个自己的扩展来控制变量的对齐内存，`__attribute__((aligned()))`。 
```
int __attribute__((aligned(16))) i;                          //(1)
int j __attribute__((aligned(16)));                          //(2)
struct S { short f[3]; } __attribute__ ((aligned (8)));      //(3)
typedef int more_aligned_int __attribute__ ((aligned (8)));  //(4)
```
(1)和(2)声明了两个变量，指定这两个变量的对齐大小为16；(3)和(4)则作用与类型，使得S和`more_aligned_int`类型的变量对齐都是8。
这个对齐的大小可以为任意2的幂次数，但是有最大上限，在我的x86_64的ubuntu上这个值是2<sup>28</sup>。按照GCC[官方文档](https://gcc.gnu.org/onlinedocs/gcc-3.3/gcc/Type-Attributes.html)中的解释，
这个attribute并不能保证变量的对齐一定是指定的大小，而是提供了一个最小值。但是实测的时候，对于标量，其提供的值就是最后对齐的值。如int的自然对齐为4，当我们使用`__attribute__`指定时，无论时`1`或`8`
都能正常工作。但是对于S，指定其对齐大小为1并没有生效，其依然是2，其挑选了一个指定值与自然对齐中较大的那个。

C++引入了新的[alignas](http://en.cppreference.com/w/cpp/language/alignas)关键字，其并不是直接指定变量或类型的对齐值，而是定义了一个最严格的需求。由于对齐值是越大越严格的（8字节对其的一定是4字节对齐），
因此其定义的是一个上限。在GCC中，我在测试的时候没有发现与`__attribute__((aligned()))`的区别，同样可以设置int的对齐值为1，和说好的不一样啊（摔）！但是在clang中就符合要求了，会提示
```
alignment.cpp:15:3: error: requested alignment is less than minimum alignment of 4 for type 'int'
  alignas(1) int b;
```
所以大家在使用的时候，就不要随便将一个变量设置成小于自然对齐的值，否则容易导致跨平台问题。

# 5. struct
struct不是一个标量，并且是一个自定义数据类型。这里有ESR的[一篇文章](http://www.catb.org/esr/structure-packing/)，本文简单的总结一起他的意思。
struct中的元素并不是紧致排列的，为了保证每个成员都是对齐的，编译器会在struct中的元素之间插入pad，例
```
struct foo1 {
    char *p;
    char c;
    long x;
};
```

假设在64bit的机器上，那么foo1的对齐值为8，这个值其实就是所有成员变量中对齐值最大的那个（一旦满足最大的那个需求，其他就都能满足了），就是`char *p`。为了保证所有成员都是对齐的，编译器会
调整内存布局，如下
```
struct foo1 {
    char *p;     /* 8 bytes */
    char c;      /* 1 byte  */
    char pad[7]; /* 7 bytes */
    long x;      /* 8 bytes */
};
```
由于`long`是8字节对齐的，而`char`是1字节对齐，所以插入了7个char以保证都是对齐的。
在上面我们说到，数组中所有元素都是对齐的，对于struct也是如此。比如下面的例子
```
struct foo4 {
    short s;     /* 2 bytes */
    char c;      /* 1 byte */
};
```
foo4的对齐值为2，但是其size为3，这样放到数组中不是对齐的。所以，为了达到需求，编译器会在struct的末尾插入空白：
```
struct foo4 {
    short s;     /* 2 bytes */
    char c;      /* 1 byte */
    char pad[1];
};
```
这样其size为4，就能满足需求了。以上的要求对于嵌套的struct也是需要满足的。

然而我们在编码时往往需要编译器保证struct成员时紧密相连的，这样可以精确控制内存的layout。现代编译器一般都提供`#pragma pack`语句来完成这一目的。
一旦定义了pack，那么后面所有的struct都要满足这个其需求。其保证成员变量的对齐值取自然对齐大小和pack中的较小值。所以对于以下示例：
```
#pragma pack(1)
struct S1 {
    char a;
    long b;
};
#pragma pack()
```
如果没有pack，编译器会在其中插入7个字节的pad，最后的size为16字节。有了pack之后，long b的对齐值成了1，那么就是紧凑排列了， size为9字节。如果们将1改成2呢？
此时long b的对齐值为2，那么插入一个pad，size为10字节。如果pack的值为16呢？由于其超过了long的align值8，那么保持long的自然对齐就好了，最终的值size为16。

顺便说一句，pack仅仅对struct和class有效，一旦设置后，对于后面所有的struct/class都生效，除非使用空的`pack()`取消，所以我们在使用的时候往往在struct的定义
前后都写上预处理语句。除此还有`push`和`pop`，其作用与`pack`相同，只是保存了历史纪录：
```
#pragma pack(push, 1)
struct A {
  char c;
  double lf;
#pragma pack(push, 2)
  struct C {
    char e;
    double f;
    char s;
  } e;
#pragma pack(pop)
};
#pragma pack(pop)
```
其size为`21 = 1(char) + 8(double) + 1(pad) + 1(char) + 1(pad) + 8(double) + 1(char) + 1(pad)`。

# 6. 总结
align在实际开发中应用得并不多，但是当我们了解其原理，就能更好地优化struct或类的结构，减少无谓的pad，从达到减少内存占用的目的。除此只玩，当编写某些需要严格控制内存
layout的时候，pack能让我们更好地控制产出的代码。