+++
draft = false
tags = ["glibc", "design"]
topics = ["design"]
description = ""
title = "glibc 中两个另类的函数"
date = "2018-11-06T09:54:10+08:00"
+++

glibc 作为使用最广泛的 libc 库，其接口设计必然也是十分精良的。出去 ANSI C 所规定的必须要拥有的接口外， glibc 也有大量自己的私有函数。
比如各种平台私有函数等。在这些私有函数中，有两个方法显得很容易被忽略，那就是 `strfry` 和 `memfrob`。你可能根本不知道有这两个函数，也
压根不会在代码中使用这两个函数。我敢说，如果 glibc 完全重新设计的话，这两个函数一定会被拿掉。这是为什么？

首先看看这两个函数的定义：
```
#define _GNU_SOURCE        
#include <string.h>

char *strfry(char *string);
void *memfrob(void *s, size_t n);
```
从函数形参上看，并没有什么特别的。这两个函数都是 `string.h` 中的，因此符合一贯的命名和参数方式。`strfry` 和 `strchr`、`strdup`之类的函数命名是统一的，唯一注意的是
其参数是`char *`类型，和大部分`strxxx`函数以`const char*`作为参数的做法是不一致的。这说明`strfry`会修改参数内容，这就极大限制了其适用范围。然后是`memfrob`函数，
他也和`memcpy`、`memmove`之类的类似，由于这些函数的形参类型都是`void *`，因此放在`string.h`中也不会显得违和。既然`strfry`会修改`string`内容，为什么不改成`memfry`?
难道其职能作用在字符串上么？

然而不是。下面来看看这两个函数的功能


> strfry:  The strfry() function randomizes the contents of string by using rand(3) to randomly swap characters in the string.  The result is an anagram of string.


功能和和shuffle类似，并且使用了 [Fisher-Yates algorithm](https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle) , 但是当你使用的时候，就会发现虽然生成的内容是随机的，但是
并不是公平的。当我们使用`abc`这三个字母进行 `strfry` 时，输出的结果是
```
abc: 165547
acb: 167887
bac: 164850
bca: 168791
cab: 167259
cba: 165666
```
其中出现最多的`bca`和`bac`之间相差了`2%`。这个其实已经不能算是特别公平的`shuffle`了。其原因是为什么？下面是`strfry`的代码
```
char * strfry (char *string)
{
  static int init;
  static struct random_data rdata;

  if (!init)
    {
      static char state[32];
      rdata.state = NULL;
      __initstate_r (time ((time_t *) NULL) ^ getpid (),
		     state, sizeof (state), &rdata);
      init = 1;
    }

  size_t len = strlen (string);
  if (len > 0)
    for (size_t i = 0; i < len - 1; ++i)
      {
	int32_t j;
	__random_r (&rdata, &j);
	j = j % (len - i) + i;

	char c = string[i];
	string[i] = string[j];
	string[j] = c;
      }

  return string;
}
```
`strfry` 使用了自有的`random`函数，因此不会污染全局的`random`序列。下面那就是 `Fisher-Yates` 算法了。那为什么会出现不平均的分布？其实原因很简单。

首先， `j` 是一个 `int32_t` 类型，其最大最大也就是 `2^32 - 1`(这里由于后面取余，因此`int32_t`和`uint32_t`没什么区别)。假设 `j` 在 `0 ~ 2^32 - 1`
之间是均匀分布的。另外又假设输入的字符串是一个很大的数据，比如说`10000`，由于`2^32 - 1 `不能被`10000` 整除，余数是`7295`。也就是说，当`10000`后面
的`10000- 7295` 被随机到的次数比前`7295`少了一次，这就造成了数据的偏差。因此一种解决方案是，当随机到后面的`10000`时重新`random`。

也就是说，`strpry` 作为 shuffle 的替代者，可能是不够合格的。

那么，`strpry`的应用场景是啥呢？另一个场景可能就是把原本有序的数据变成垃圾了，向咱们扔垃圾一样，先划掉字迹，然后揉成一团或塞进碎纸机。因此可以用作销毁数据，
但是既然有了`memset`，为什么需要`strpry`函数呢？效率还更高。这一应用场景也就没啥必要了。 所以，`strpry`被人忽略也就不奇怪了。


下面来谈谈`memfrob`。

这个函数更加奇葩，根据描述

> The memfrob() function encrypts the first n bytes of the memory area s by exclusive-ORing each character with the number 42.  The effect can be reversed by using memfrob() on the encrypted memory area.
> 
> Note that this function is not a proper encryption routine as the XOR constant is fixed, and is suitable only for hiding strings.


这玩意儿就是对一块内存中的每个字节取一个对`42`的`XOR`操作。异或操作常用于加密领域，因为其是可以恢复的，一个数两次异或之后还是自身。那么问题来了，`memfrob`为什么要
异或`42` ？ 显然这个`42`就是拍脑袋想出来的，因为它是[生命、宇宙以及一切的终极答案](https://zh.wikipedia.org/wiki/%E7%94%9F%E5%91%BD%E3%80%81%E5%AE%87%E5%AE%99%E4%BB%A5%E5%8F%8A%E4%BB%BB%E4%BD%95%E4%BA%8B%E6%83%85%E7%9A%84%E7%B5%82%E6%A5%B5%E7%AD%94%E6%A1%88)，
来自 银河系漫游指南 。但是这里对于这里的程序是没有什么作用的，而且你也没办法修改它，它就这样写死在代码里面。

或许有人认为，`memfrob`可以用来加密，但是文档上明确说它并不能用于加密，因为太容易被破解了，如果需要加密应该使用更成熟的一些解决方案，如`des`、`aes`之类。
另外还有一个作用，是防止被人用`strings`这样的程序窥探可执行文件中的内容，这确实可以蒙过一些初级玩家，但是对于一些稍微掌握点破解的人来说也是徒劳无功的。而且这样也会
代码编码上的不利，因为通过`strings`查看的字符串很多都不能被修改，因此你在使用的时候还得先拷贝一份再使用。

从上面看来`memfrob`绝不推荐使用，就算使用异或，那也应该自行实现而不是用这个写死`42`的版本。

今天我们介绍的这两个函数可以说是非常奇葩了，而且往往还经常在网上被拉出来鞭尸一顿。但是我们能从其中却能学习到一下函数设计的基本坑点，在下次使用某些库的时候也需要更深入思考其局限性和使用场景。