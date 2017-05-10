+++
date = "2017-05-10T20:05:41+08:00"
description = ""
draft = false
tags = ["lua", "gc"]
title = "解析lua gc 中的参数控制"
topics = []

+++

lua gc 调优主要涉及到两个两个参数`setpause`和`setstepmul`，使用方法如下：

```
collectgarbage("setpause", 200)
collectgarbage("setstepmul", 200)
```

这两个值的默认值都是`200`，那么这代表着什么意思呢？通过查看代码
```
static const char *const opts[] = {"stop", "restart", "collect",
  "count", "step", "setpause", "setstepmul", NULL};
static const int optsnum[] = {LUA_GCSTOP, LUA_GCRESTART, LUA_GCCOLLECT,
  LUA_GCCOUNT, LUA_GCSTEP, LUA_GCSETPAUSE, LUA_GCSETSTEPMUL};
```
其实`collectgarbage`对应的就是`lua_gc`方法，下面是其中的部分逻辑的：
```c
LUA_API int lua_gc (lua_State *L, int what, int data) {
  switch (what) {
    case LUA_GCSTOP: g->GCthreshold = MAX_LUMEM;
    case LUA_GCRESTART: g->GCthreshold = g->totalbytes;
    case LUA_GCCOLLECT: luaC_fullgc(L);
    case LUA_GCCOUNT: res = cast_int(g->totalbytes >> 10);
    case LUA_GCCOUNTB:  res = cast_int(g->totalbytes & 0x3ff);
    case LUA_GCSTEP: {
      lu_mem a = (cast(lu_mem, data) << 10);
      if (a <= g->totalbytes)
        g->GCthreshold = g->totalbytes - a;
      else
        g->GCthreshold = 0;
      while (g->GCthreshold <= g->totalbytes) {
        luaC_step(L);
        if (g->gcstate == GCSpause) {  /* end of cycle? */
          res = 1;  /* signal it */
          break;
        }
      }
      break;
    }
    case LUA_GCSETPAUSE: res = g->gcpause; g->gcpause = data;
    case LUA_GCSETSTEPMUL: res = g->gcstepmul; g->gcstepmul = data;
}
```
其中我们看到一些有意思的参数，在`g(global_State)`中有如下定义：
```c
/*
** `global state', shared by all threads of this state
*/
typedef struct global_State {
//.....
  lu_mem GCthreshold;
  lu_mem totalbytes;  /* number of bytes currently allocated */
  lu_mem estimate;  /* an estimate of number of bytes actually in use */
  lu_mem gcdept;  /* how much GC is `behind schedule' */
  int gcpause;  /* size of pause between successive GCs */
  int gcstepmul;  /* GC `granularity' */
//......
} global_State;
```

可以看到，对于`LUA_GCSTOP`是将`GCthreshold`设置成一个很大的值`MAX_LUMEM`(`~(size_t)0)-2`)，而`LUA_GCRESTART`则将`GCthreshold`设置成`totalbytes`。对于`LUA_GCSETPAUSE`和`LUA_GCSETSTEPMUL`则是分别设置了`gcpause`和`gcstepmul`的值。从注释中我们可以看到各自值的解释。

| 参数 | 意义 |
|----|---|
| GCthreshold | GC的门槛，当totalbytes大于这个值时触发gc step |
| totalbytes | 由内存分配器分配的**实际**内存 |
| estimate | **估计**的，正在使用的内存大小，小于 `totalbytes` |

下面这段代码是代码中随处可见，如`lua_createtable`等，在执行操作之前都会检查是否需要触发`gc`，以保证内存利用率。
```c
80	#define luaC_checkGC(L) { \
81	  condhardstacktests(luaD_reallocstack(L, L->stacksize - EXTRA_STACK - 1)); \
82	  if (G(L)->totalbytes >= G(L)->GCthreshold) \
83		luaC_step(L); }
```
当 `totalbytes >= GCthreshold`时触发step。因此`LUA_GCRESTART`之后，下一次`checkGC`的时候会立即出发`luaC_step`。可以看到
`totalbytes`和`GCthreshold`是控制`GC`的关键参数。

每个回收周期结束重置`GCthreshold` ，这里用到了的estimate。因为带有 __gc 元方法的 `userdata` 需要两个gc周期
才能回收，在第一个gc周期中其 `__gc`元方法会被调用，而在第二个回收周期内内存会被真正回收。因此，`estimate`是不包含那些`__gc`元方法被调用的`userdata`的，而`totalbytes`会包含（因为其反映的是真实内存占用情况）。
```
#define setthreshold(g)  (g->GCthreshold = (g->estimate/100) * g->gcpause)
```
由这段代码可以看出，我们设置的`gcpause`值影响的是下一周期开始的事件，默认`200`的意思时，当当前**真实**内存占用超过当前**估计**内存占用的两倍时，才开启下一回收周期。所以如果你含`__gc`方法的`userdata`过大的话，很可能在第一次周期结束后立马开启了第二周期。如果设置的`gcpause`值小于`100`的话，那么同样两次`gc`周期中间是没有间隔的。

接下来看`luaC_step`的代码
```c
610	void luaC_step (lua_State *L) {
611	  global_State *g = G(L);
612	  l_mem lim = (GCSTEPSIZE/100) * g->gcstepmul;
613	  if (lim == 0)
614	    lim = (MAX_LUMEM-1)/2;  /* no limit */
615	  g->gcdept += g->totalbytes - g->GCthreshold;
616	  do {
617	    lim -= singlestep(L);
618	    if (g->gcstate == GCSpause)
619	      break;
620	  } while (lim > 0);
621	  if (g->gcstate != GCSpause) {
622	    if (g->gcdept < GCSTEPSIZE)
623	      g->GCthreshold = g->totalbytes + GCSTEPSIZE;  /* - lim/g->gcstepmul;*/
624	    else {
625	      g->gcdept -= GCSTEPSIZE;
626	      g->GCthreshold = g->totalbytes;
627	    }
628	  }
629	  else {
630	    setthreshold(g);
631	  }
632	}
```
这里`stepmul`控制的就是`step`的长度，越大则每步所进行的操作也就越多，拥有更多的「费」。其中`GCSTEPSIZE`的值为`1024`。也就是说默认`stepmul`为200的情况下，大约可已进行`2048`「费」，那么「费」是怎么定义的呢？从代码可以看到清除一条`string`表和任意一个`gc`对象为`10`「费」，调用`__gc`元方法为`100`「费」，除非是`sweep`阶段否则内存不会减少，因此不能使用内存差值来表示工作进度，所以引入了「费」。如果你把`stepmul`设置为`0`的话，那么`lim`就是`(MAX_LUMEM-1)/2`
为什么是这么奇怪的数值？因为`MAX_LUAEME`是`~(size_t)0)-2`，无符号整型，而`l_mem`是有符号的，直接赋值会溢出的。

`luaC_step`的设计思路是： 每当新增分配的内存数超过`GCSTEPSIZE`就触发一次。由于lua只会在gc过程中释放对象，所以
`totalbytes`在gc过程外时只增不减的，因此`luaC_step`总是会得以触发。为了准确记录新增内存使用量，lua 使用了`gcdept`变量。
这种设计是为了防止`luaC_step`被频繁触发，控制一个较合理的粒度。

另外，`gcdept`在每个周期末尾会清零。
```
592	    case GCSfinalize: {
593	      if (g->tmudata) {
594	        GCTM(L);
595	        if (g->estimate > GCFINALIZECOST)
596	          g->estimate -= GCFINALIZECOST;
597	        return GCFINALIZECOST;
598	      }
599	      else {
600	        g->gcstate = GCSpause;  /* end collection */
601	        g->gcdept = 0;
602	        return 0;
603	      }
604	    }
```
