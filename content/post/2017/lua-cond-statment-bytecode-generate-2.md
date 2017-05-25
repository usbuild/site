+++
date = "2017-05-25T14:26:47+08:00"
description = ""
draft = false
tags = ["lua", "bytecode"]
title = "lua 5.1 分支语句 bytecode 的生成（二）"
topics = []

+++

上篇我们谈到了 IF 语句的 bytecode 生成，今天来谈谈布尔表达式与短路求值。

考虑到下面的表达式
```lua
a = a or 1024
```
其生成的字节码为
```
1       [1]     GETGLOBAL       0 -1    ; a
2       [1]     TEST            0 0 1
3       [1]     JMP             1       ; to 5
4       [1]     LOADK           0 -2    ; 1024
5       [1]     SETGLOBAL       0 -1    ; a
6       [1]     RETURN          0 1
```
其实与
```lua
if not a then
    a = 1024
end
```
生成的代码几乎一致，只是少了像自己赋值的那部分。现在我们看看这条短路求值语句的字节码是怎么生成的。

`a = a or 1024` 这是一个赋值语句，所以调用使用的是`assignment`函数，其中我们关注的调用链是
`assignment -> luaK_storeevar -> luaK_exp2anyreg -> luaK_exp2nextreg -> exp2reg ` 由于 `a or 1024`是个二元运算符，
在代码中可以看到，在读到`or`之前是`luaK_infix`，读到`or`之后是`luaK_postfix`，我们看看两者的做法：
```
-- luaK_infix
716	    case OPR_OR: {
717	      luaK_goiffalse(fs, v);
718	      break;
719	    }
```
```
-- luaK_postfix
746	    case OPR_OR: {
747	      lua_assert(e1->f == NO_JUMP);  /* list must be closed */
748	      luaK_dischargevars(fs, e2);
749	      luaK_concat(fs, &e2->t, e1->t);
750	      *e1 = *e2;
751	      break;
752	    }
```
关键还是上文说到的`luaK_goiffalse`，
```
580	  luaK_concat(fs, &e->t, pc);  /* insert last jump in `t' list */
581	  luaK_patchtohere(fs, e->f);
```
如果返回 true 的话，那么跳转到某个“未知”的地方，false 的话直接执行下一句。那么这个“未知”的地方是怎么确定的呢？
答案在`exp2reg`里面。

```
394	  if (hasjumps(e)) {
395	    int final;  /* position after whole expression */
396	    int p_f = NO_JUMP;  /* position of an eventual LOAD false */
397	    int p_t = NO_JUMP;  /* position of an eventual LOAD true */
398	    if (need_value(fs, e->t) || need_value(fs, e->f)) {
399	      int fj = (e->k == VJMP) ? NO_JUMP : luaK_jump(fs);
400	      p_f = code_label(fs, reg, 0, 1);
401	      p_t = code_label(fs, reg, 1, 0);
402	      luaK_patchtohere(fs, fj);
403	    }
404	    final = luaK_getlabel(fs);
405	    patchlistaux(fs, e->f, final, reg, p_f);
406	    patchlistaux(fs, e->t, final, reg, p_t);
407	  }
```
由于我们设置了`e->t`或`e->f`，所以`hasjumps`判断成立。由于`TESTSET`已经提供了赋值的寄存器，因此是不需要额外记录判断结果的。而对于其他的入`LT`、`JMP`等，其本身是不记录任何判断结果的，为了记录只能在 JMP 完成之后，设置到寄存器中，
这也就是此处`code_label`存在的原因。接下来是`patchlistaux`，其定义如下：
```
150	static void patchlistaux (FuncState *fs, int list, int vtarget, int reg,
151	                          int dtarget) {
152	  while (list != NO_JUMP) {
153	    int next = getjump(fs, list);
154	    if (patchtestreg(fs, list, reg))
155	      fixjump(fs, list, vtarget);
156	    else
157	      fixjump(fs, list, dtarget);  /* jump to default target */
158	    list = next;
159	  }
160	}
```

其中 `patchtestreg`定义如下：
```
131	static int patchtestreg (FuncState *fs, int node, int reg) {
132	  Instruction *i = getjumpcontrol(fs, node);
133	  if (GET_OPCODE(*i) != OP_TESTSET)
134	    return 0;  /* cannot patch other instructions */
135	  if (reg != NO_REG && reg != GETARG_B(*i))
136	    SETARG_A(*i, reg);
137	  else  /* no register to put value or register already has the value */
138	    *i = CREATE_ABC(OP_TEST, GETARG_B(*i), 0, GETARG_C(*i));
139	
140	  return 1;
141	}
```
其中`vtarget`是我们当前的位置`final`，而`dtarget`是`p_f`或`p_t`。这两条语句的作用其实是将最终`TESTSET`指令的结果传送到`reg`，
如果不是`TESTSET`的话那么说明不产生值，那`reg`就需要上面的`codelabel`来产生了。至此这部分代码分析完成。

下面是一些函数的简单解释，可以稍微看看：

`luaK_nil`函数，生成的是`LOADNIL`字节码，其作用是将from ~ from + n之间的寄存器设置成nil，这里做了一些优化如：如果合并相邻的`LOADNIL`，函数初始化时可以不需要重复初始化等。
注意优化的前提是`fs->pc > fs->lasttarget`，即这条指令必须可以省略。

`luaK_jump`函数，其目的是生成一个`JMP`指令。这是个无条件跳转指令。那么其目标呢？其实就是 `fs->jps`。注意后面的`luaK_contat`，其目的是将l2链接到l1的后面，这是为了连续跳转
考虑的。

`condjump` 生成条件跳转语句，lua为了生成字节码的便利性，每个条件调转语句如`LT`, `TEST`等后面都跟着一个`JMP`，当条件不满足时直接指向`JMP`语句，否则就跳到`JMP`的下一条，
减少了编码的复杂度啊

`fixjump`把`PC`处的指令（当然是JMP指令）改成目标为`dest`，当然是相对地址了

`luaK_getlabel`，标记一下，把当前的lasttarget改成pc，这个lasttarget就是和上面的`luaK_nil`结合起来的，防止上面的误优化。

`getjump`和上面的fixjump相对应，返回PC所在那条指令的跳转目标。

`getjumpcontrol` 由于`JMP`上一条很多情况下都是跟着条件跳转指令的，那么这条指令就是获取这条条件跳转指令的。如果是那么返回上一条，否则返回当前pc。除了`jmp`之外，其他如`FORLOOP`, `FORPREP`等指令也会产生跳转

`patchtestreg` 修改`TESTSET`指令，这个指令一般用于短路求值，

`patchlistaux ` 对于一个jump list，如果是`TESTSET`，那么将赋值寄存器修改为reg并将jump目的地修改为vtarget, 否则修改为dtarget。

`dischargejpc` 对jpc进行`patchlistaux`，其中vtarget和dtarget都是pc

`patchlist` 如果target为pc，那么调用patchtohere；否则调用patchlistaux

`patchtohere`先getlabel标记一下，然后将当前的list放到jpc后面

`jpc`那些将要跳到当前位置的链表，由于所有code的增加的欧式`luaK_code`，所以会在这个函数中调用`dischargejpc`

