+++
date = "2017-04-21T17:37:30+08:00"
description = ""
draft = false
tags = ["lua", "game"]
title = "lua与C交互中的死循环检测"
topics = []

+++

现在很多游戏引擎都是`C++` + `lua`的结构，一旦某个服务器开发人员大意写出死循环代码，很容易导致服务无响应，影响服务器稳定。所以引擎中最好能提供一个死循环的检测机制，一旦出现死循环则执行一些行为打断当前流程。

死循环的检测是一个[停机问题](https://en.wikipedia.org/wiki/Halting_problem)。我们无法判断到底是任务执行时间过长，还是进入了真正的死循环，好在这对我们的服务来说区别并不重要。所以一个简单的判断条件是，执行时间是否超过了预定的阈值。

`C++`中集成`lua`，调用到游戏逻辑时，一般通过[pcall](http://pgl.yoyo.org/luai/i/lua_pcall)，但是一旦调用了`pcall`，代码的执行路径便进入了`lua`的世界，除非通过信号机制才能在当前线程中中断，实现执行其他分支的目的。除此之外，`lua`还提供了`debug.sethook`函数，可以在执行正常逻辑中触发`hook`，实现监测超时的功能。所以我们有以下两种方案：

# 1. 使用`debug.sethook()`来实现


> debug.sethook ([thread,] hook, mask [, count])
> Sets the given function as a hook. The string mask and the number count describe when the hook will be called. The string mask may have the following characters, with the given meaning:
> 
> "c": the hook is called every time Lua calls a function;
> "r": the hook is called every time Lua returns from a function;
> "l": the hook is called every time Lua enters a new line of code.
> With a count different from zero, the hook is called after every count instructions.

所以我们只要在执行`pcall`之前设定类似如下的代码:
```lua
debug.sethook(function()error("timeout")end, "c", 10000)
```
理论上只要代码指令数超过10000条就能触发`error`。好像挺完美的。

But，在`luajit`下这条不一定成立，因为执行的逻辑被`jit`编译了，而在这种情况下，`hook`是不会触发的
> If your program is running in a tight loop and never falls back to the interpreter, the debug hook never runs and can't throw the "interrupted!" error.

但是还有一个未公开的编译选项`LUAJIT_ENABLE_CHECKHOOK`，在`lj_record.c`文件的最后面，上面写道
> Regularly check for instruction/line hooks from compiled code and
> exit to the interpreter if the hooks are set.
> 
> This is a compile-time option and disabled by default, since the
> hook checks may be quite expensive in tight loops.

看似可以，但是注意，如果`hook`被设置了，则执行的代价是比较昂贵的。对于游戏而言，大部分的时间都在`lua`层，而为了监测死循环，几乎
要在所有的lua执行过程中设置`hook`，这是不太容易接受的。好在下面的注释提到了
> You can set the instruction hook via lua_sethook() with a count of 1
> from a signal handler or another native thread. Please have a look
> at the first few functions in luajit.c for an example (Ctrl-C handler).

嗯，看样子只能使用第二种方案了。

# 2. 使用信号来实现

在lua的命令行程序中我们可以通过`Ctrl-C`中断正在执行的程序
```
>  for i=1,10000000 do sum = sum + i end
^Cinterrupted!
stack traceback:
        stdin:1: in main chunk
        [C]: in ?

```

仔细看`lua.c`文件，可以看到以下代码
```C
static void lstop (lua_State *L, lua_Debug *ar) {
  (void)ar;  /* unused arg. */
  lua_sethook(L, NULL, 0, 0);
  luaL_error(L, "interrupted!");
}


static void laction (int i) {
  signal(i, SIG_DFL); /* if another SIGINT happens before lstop,
                              terminate process (default action) */
  lua_sethook(globalL, lstop, LUA_MASKCALL | LUA_MASKRET | LUA_MASKCOUNT, 1);
}

// ....
//in docall
signal(SIGINT, laction);
status = lua_pcall(L, narg, (clear ? 0 : LUA_MULTRET), base);
signal(SIGINT, SIG_DFL);
```
嗯，在执行`pcall`之前设置了信号处理函数，捕捉`Ctrl-C`的信号，一旦发生，则立马调用`lua_sethook`函数，指定在执行下一行代码时调用`lstop`，而在`lstop`中就直接抛出`error`了。所以问题是 **`lua_sethook`是可以在信号处理函数中调用的**？

答案：是

从源码中可以看到
```
/* This function can be called asynchronously (e.g. during a signal). */
LUA_API int lua_sethook(lua_State *L, lua_Hook func, int mask, int count)
```
除此之外，从`luajit`的源码注释来看，不仅仅在信号处理函数中，在其他线程中也能被调用
> from a signal handler or another native thread.

所以，这种方案是可行的。因此，对于单线程程序而言，可以通过设置`alarm`来实现超时设置
```
alarm(10);// trigger after 10s
signal(SIGALRM, laction);
status = lua_pcall(L, narg, (clear ? 0 : LUA_MULTRET), base);
alarm(0)
signal(SIGALRM, SIG_DFL);
```
而对于多线程程序，可以直接启一个定时器来来`check`，而不用使用很恶心的信号。

值得一提的是，使用这种方式触发超时`error`可以很轻易地在`pcall`中捕获，从而而已实现堆栈的打印等功能，方便查找和定位问题。
