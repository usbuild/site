+++
date = "2016-09-01T17:40:08+08:00"
draft = false
title = "Lua Table中HashMap介绍"
tags = ["Lua", "Implementation"] 

+++

[Table](https://www.lua.org/pil/2.5.html) 在Lua中有着极其重要的应用，从核心语言实现，如[short string intern](https://en.wikipedia.org/wiki/String_interning)，
到利用[metatable](https://www.lua.org/pil/13.html)实现的[class](lua-users.org/wiki/LuaClassesWithMetatable)，table几乎无所不能。如此高频度地利用也就意味着lua必须要有一个高效的
table实现。

很多语言提供了array和associative array两种数据结构。array是指以某个指定的最小整数下标(一般是0)开始的连续存储的数据结构，它有vector、list、array、ArrayList等多种名称；associative array，中文
也叫关联数组，即将一对key/pair之间关联起来，它一般也被称为map、dict等。Lua并不提供array，因为数组本身也是一种特殊的关联数组。但是从内部表示上，array和map有着极大的不同，array只需要一块连续的
内存即可实现，而map则有多种实现。Lua为了效率，将一部分整数下标的元素存储在array part中，而将其他元素存储在hashmap中，实现在外部接口不变的情况下实现了效率的最大化。array部分没有什么特别需要
优化的，其就是一整块连续的内存，存储和读取的时间复杂度都是O(1)，而hashmap的实现称为了lua table设计的重点。

map有多种实现手段，在stl中，默认的map使用的是红黑树，存储和读取的时间复杂度都是O(logn)；虽然红黑树的表现十分稳定，但是实现比较复杂而且无法满足极端性能要求，
C++11中添加新的[unordered_map](http://en.cppreference.com/w/cpp/container/unordered_map)，其实现就是使用了一个hashmap。hashmap的基本流程是使用一个hash函数来将
一个key映射到一块连续内存中，实现在理想情况下访问和删除接近O(1)的时间复杂度。

由于一般key的取值范围大于hashmap slot数目，所以不可避免地出现冲突的状况。在教科书中，解决这种冲突一般有两种方法：[链表法](https://en.wikipedia.org/wiki/Hash_table#Separate_chaining)
和[开放寻址法](https://en.wikipedia.org/wiki/Open_addressing)。链表法的实现比较简单，将冲突的元素使用链表链接起来即可；而开放寻址法则需要多次计算，直至找到一个没有冲突的slot为止。
这两者都有自己的优缺点，链表法由于使用了链表，无法充分利用CPU缓存，并且实现深拷贝难度较大；而开放寻址法无法实现删除元素的功能，并且当元素密度比较大时，效率非常低。

Lua table使用了一个折中的方案，叫做[Coalesced_hashing](https://en.wikipedia.org/wiki/Coalesced_hashing)，结合使用了链表法和开放寻址法。

![Coalesced_hashing](https://upload.wikimedia.org/wikipedia/en/4/4c/CoalescedHash.jpg)

当插入一个元素时，定义其原本应该在的位置为mainposition，如果mainpoisition对应的slot是空的，则直接插入；如果非空，看看在那个位置上的元素的mainposition是不是当前的slot，如果不是的
话，则将其移动到任意一个空的slot(位置A)，然后将当前的元素插入到mainposition位置，并将当前的next字段设置成位置A，形成链表。如果占用元素mainposition就是当前位置，则将待插入的
元素插入到任意一个空的位置上，并链接到占用元素的后面。

通过上面的过程，实现了所有的元素都尽量保存在mainposition上，当查找的时候也能使用更少的次数来找到元素位置。这对元素本来就在hashmap中，效率是比较高的。但是，当元素不在hashmap中，查找的代价
比较高。

lua table的代码实现在[这里](https://www.lua.org/source/5.3/ltable.c.html)，实现非常简洁明了，也不是很难懂，但是对于平时经常使用lua的同学来说读一读还是很有必要的。