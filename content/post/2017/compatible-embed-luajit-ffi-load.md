+++
date = "2017-05-09T22:05:47+08:00"
description = ""
draft = false
tags = ["luajit", "ffi"]
title = "嵌入 luajit 时同时使用 ffi 和 c api 的解决方案"
topics = []

+++

我们都喜欢[ffi](http://luajit.org/ext_ffi.html)。

ffi 的接口简单易用，当使用第三方没有提供 lua 接口的库来说，使用 ffi 接入相当容易。
而且效率比较高，通过 ffi 调用的接口是可以被 jit 编译的，效率相对于使用传统的 [lua c api](https://www.lua.org/pil/24.html)来说要
高得多。ffi 直接使用了操作系统的调用模型，除了数据结构转化的代价外没有额外的负担。而使用传统 c api 则是
通过 lua 虚拟栈来实现，并且需要和 lua 的调用模型兼容，实现起来比较复杂。

但是，对于接入 lua 的程序而言，仅仅支持 luajit 是有一定风险的，相对于 [puc lua](https://www.lua.org/)， luajit 的主要开发者和维护者
比较少，应用面也不如 lua。所以大部分的面相 lua 的程序都会同时支持 luajit 和 lua。ffi 是 luajit 内置的模块，而 lua 却不携带这个模块，
有一些开源的项目， 如 facebook 开发的[这个](https://github.com/facebook/luaffifb)，但是经过我们的测试其效率比普通的c api还慢: (。
所以一个比较折中的方案是同时提供 ffi binding 和 c binding 的方案，这是大部分 lua 库的选择。

如果提供的是一个 so 库，那么只需要提供个 lua 入口文件，如果使用 ffi 的话，则调用相关的 lua 文件。如果是 c binding 的话，那就调用具体的
so文件。然而这在我们的项目中是不可行的，为了保证部署的简化，我们的程序只有一个可执行文件，不会依赖除一些核心 so 库之外的 so 库。所有的
c binding 代码都是在可执行文件里面的。这就意味着我们需要 `ffi.load` 我们自己的可执行文件。大概的代码如下：

```C
// main.c

char* encode(const char* input, size_t size, size_t *out_size) { // 假设这是我们的工作函数
    //...
}

// c api
int l_encode(lua_State* L) { // 为了让上面的接口能被 lua 调用，需要转换一下
    size_t length, out_size;
    char *in_data, *out_data;
    in_data = lua_tolstring(L, 1, &length);
    out_data = encode(in_data, length, &out_size);
    lua_pushlstring(L, out_data, out_size);
    return 1;
}

// register in some place 
lua_pushcfunction(L, l_encode); // 注册到 lua 虚拟机中
lua_setglobal(L, "c_encode");
```

这里是统一的入口文件：
```lua
-- ffi.lua

if ffi then -- 如果能使用 ffi 的话
    lib = ffi.load(????) -- 这里改怎么写
    ffi.cdef[[
        char* encode(const char* input, size_t size, size_t *out_size);
    ]]
    -- do some dirty jobs
    lib.encode -- ...
else
    encode = c_encode -- 使用 c api 版本
end


```

然而这是不可行的。

ffi load 调用的其实就是[dlopen](http://man7.org/linux/man-pages/man3/dlopen.3.html)。如果我们有一个可执行文件 `a.out`，在这里面
调用 `dlopen("a.out", ...)`，其作用是将 `a.out` 的内容加载到内存中，加上我们之前运行 `a.out` 的程序（其实也是用 `/lib64/ld-linux-x86-64.so` 加载的）。
这样内存中就有了两份一样的镜像，一个全局变量会对应两个内存地址。这种产生的原因可以参考[程序员的自我修养](https://book.douban.com/subject/3652388/)。

使用现有的 luajit 接口是无法做到的。但是 `dlopen` 可以

> If filename is  NULL,  then  the  returned handle  is for the main program

当 filename 为 NULL 时，直接返回当前程序的 dl handle，可以取得各种 symbol 的地址。所以我们可以稍微修改下 luajit 的实现:

```c
// in lj_clib.c
static const char *clib_extname(lua_State *L, const char *name
{
  if (!name[0]) return NULL; // 添加这一行
  if (!strchr(name, '/')
#if LJ_TARGET_CYGWIN
      && !strchr(name, '\\')
#endif
     ) {
    if (!strchr(name, '.')) {
      name = lj_strfmt_pushf(L, CLIB_SOEXT, name);
      L->top--;
// ...
```
那么在应用中就可以这样使用了

```lua
local ffi = require("ffi")
local lib = ffi.load("")
ffi.cdef[[...]]
-- lib.doSomething
```

这样对于单可执行文件就可以是的 c binding 和 ffi binding 共存了。
