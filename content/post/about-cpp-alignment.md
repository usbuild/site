+++
date = "2016-09-25T09:13:27+08:00"
description = ""
draft = true
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
计算机访问内存并不是一个字节一个字节访问的，而是以一个内存块作为基本单位。这个内存块的大小
