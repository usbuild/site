+++
date = "2017-05-20T15:57:13+08:00"
description = ""
draft = false
tags = ["lua", "bytecode"]
title = "lua 5.1 分支语句 bytecode 的生成（一）"
topics = []

+++

本文只对 `IF cond THEN block {ELSEIF cond THEN block} [ELSE block] END` 语法的字节码生成过程进行描述。

## 生成的结果
首先我们看下面的示例，仅为演示：

```
local cond1 = true
local cond2 = true
if cond1 then
    cond1 = false
elseif cond2 then
    cond2 = false
else
    cond1 = false
end
```
使用`luac -l -l`选项列出来的结果为
```
main <test.lua:0,0> (12 instructions, 48 bytes at 0x184e530)
0+ params, 2 slots, 0 upvalues, 2 locals, 0 constants, 0 functions
        1       [1]     LOADBOOL        0 1 0
        2       [2]     LOADBOOL        1 1 0
        3       [3]     TEST            0 0 0
        4       [3]     JMP             2       ; to 7
        5       [4]     LOADBOOL        0 0 0
        6       [4]     JMP             5       ; to 12
        7       [5]     TEST            1 0 0
        8       [5]     JMP             2       ; to 11
        9       [6]     LOADBOOL        1 0 0
        10      [6]     JMP             1       ; to 12
        11      [8]     LOADBOOL        0 0 0
        12      [9]     RETURN          0 1
constants (0) for 0x184e530:
locals (2) for 0x184e530:
        0       cond1   2       12
        1       cond2   3       12
upvalues (0) for 0x184e530:
```
这里我们可以看到最终的生成结果。我们关注的是其中的`TEST`和`JUMP`。在第3行的`TEST`，其意思是如果0号寄存器中的内容(cond1)
为false(0)的话，那么就执行下面的`JMP`语句，否则就调过`JMP`直接到第5行。`LUA`中的分支实现都是使用`TEST`等后面紧跟`JMP`实现的，
从主 dispatch 代码中可以看到

```
    // ...
      case OP_TEST: {
        if (l_isfalse(ra) != GETARG_C(i))
          dojump(L, pc, GETARG_sBx(*pc));
        pc++;
        continue;
      }
      case OP_TESTSET: {
        TValue *rb = RB(i);
        if (l_isfalse(rb) != GETARG_C(i)) {
          setobjs2s(L, ra, rb);
          dojump(L, pc, GETARG_sBx(*pc));
        }
        pc++;
        continue;
      }
      // ...
```
`JMP`跳转，永远都是分支不成立的情况，而`TEST`成功后的跳转永远是跳过下一行，失败的话继续执行接下来的JMP。`if`语句的字节码解析就到这里，后面的`elseif`等都是比较简单的，再了解这个事实之后。
那么这种字节码是怎么生成的呢？下面来分析下。

## 生成的过程
`if`语句的代码在`lparser.c`里面，最上层如下：
```
static void ifstat (LexState *ls, int line) {
  /* ifstat -> IF cond THEN block {ELSEIF cond THEN block} [ELSE block] END */
  FuncState *fs = ls->fs;
  int flist;
  int escapelist = NO_JUMP;
  flist = test_then_block(ls);  /* IF cond THEN block */
  while (ls->t.token == TK_ELSEIF) {
    luaK_concat(fs, &escapelist, luaK_jump(fs)); // 将 escapelist 串起来，这里的 luaK_jump 会跳转到 end
    luaK_patchtohere(fs, flist); // 把上面那个`JMP(1/3)` 地址修改对
    flist = test_then_block(ls);  /* ELSEIF cond THEN block */
  }
  if (ls->t.token == TK_ELSE) {
    luaK_concat(fs, &escapelist, luaK_jump(fs));
    luaK_patchtohere(fs, flist);
    luaX_next(ls);  /* skip ELSE (after patch, for correct line info) */
    block(ls);  /* `else' part */
  }
  else
    luaK_concat(fs, &escapelist, flist); // 这里把 flist 串起来了，意思是没有 else 语句，此时 flist 指向就是 end
  luaK_patchtohere(fs, escapelist); // 修改 escapelist 到 end 语句的结尾
  check_match(ls, TK_END, TK_IF, line);
}
```

在读取 token 的时候，遇到 `if ... then` 会生成
```
TEST reg 0 predict
JMP ??? (1)
```
由于我们不知道后面代码的内容，所以无法确定`???`该填写多少，但是我们还是要记住这个位置，将来我们要把值填写进去，这个值其实就存
在`flist`。然后我们读到`elseif cond then`语句，这就意味着第一段代码的结束此时应该要跳转出这个`if`
语句，所以此时应该插入一个`JMP(2)`到整个语句的结束，因为有多个 block 的存在，后面可能会有很多这种类似的
`JMP`，如上面示例中的各种`to 12`，这些位置都无法确定，所以我们使用一个escapelist来指向这个地址，方便后面处理。
现在回头看`JMP(1)`位置就确定了，所以当前的PC就是`flist`的指向由于`elseif`又是一个分支语句，所以又可以生成一段 `TEST & JMP(3)`代码了。同样`JMP(2)`的位置是无法确定的。
现在来谈谈`escapelist`，定义
```
int escapelist = NO_JUMP;
```
这是个 int 啊，对于多个位置的`JMP(2)`要怎么处理？lua 采用了一种巧妙的机制，由于此时的`JMP`是无效的，还没有解析到正式地址的，
所以其中的目标地址域是没有使用的。因此，可以采用串起来的方式，escapcelist指向第一个没有解析的`JMP`，然后这个`JMP`的指向地址
是下一个没有解析的`JMP`，这样一来就形成了链表的结构。后面可以一起修改目标地址通过`luaK_patchtohere`来实现。

## 事情没那么简单
我们我们详细查看的话，`test_then_block` -> `cond` -> `luaK_goiftrue`，看看`luaK_goiftrue`函数的实现：

```
void luaK_goiftrue (FuncState *fs, expdesc *e) {
  int pc;  /* pc of last jump */
  luaK_dischargevars(fs, e);
  switch (e->k) {
    case VK: case VKNUM: case VTRUE: {
      pc = NO_JUMP;  /* always true; do nothing */
      break;
    }
    case VFALSE: {
      pc = luaK_jump(fs);  /* always jump */
      break;
    }
    case VJMP: {
      invertjump(fs, e);
      pc = e->u.s.info;
      break;
    }
    default: {
      pc = jumponcond(fs, e, 0);
      break;
    }
  }
  luaK_concat(fs, &e->f, pc);  /* insert last jump in `f' list */
  luaK_patchtohere(fs, e->t);
  e->t = NO_JUMP;
}
```
前面的几种，如VK、VKNUM、VTRUE都是始终成立的，所以其`e->f`是不存在的，因此为`NO_JUMP`，而对于 VFALSE，其始终应该走错误分支，因此其`e->f`为一条JMP。`VJUMP`是比较语句生成的, 所以其值就是代表了`e->t`和`e->f`，因此其`e->f`
就是`invertjump`了。在各种错误JMP都生成完之后，接下来就是正确分支了，所以直接就`luaK_patchtohere`了，当前的就是正确的逻辑。

我们关注的重点其实是 `jumponcond`:
```
static int jumponcond (FuncState *fs, expdesc *e, int cond) {
  if (e->k == VRELOCABLE) {
    Instruction ie = getcode(fs, e);
    if (GET_OPCODE(ie) == OP_NOT) {
      fs->pc--;  /* remove previous OP_NOT */
      return condjump(fs, OP_TEST, GETARG_B(ie), 0, !cond);
    }
    /* else go through */
  }
  discharge2anyreg(fs, e);
  freeexp(fs, e);
  return condjump(fs, OP_TESTSET, NO_REG, e->u.s.info, cond);
}
```
对于 `if not xxxx then `之类的语句，显然其判断结果值不会被引用（只是被判断语句使用而已）所以这里使用`OP_TEST`，其他所有情况
都是使用的`OP_TESTSET`。我们可以看看`TESTSET`的定义：

> `TESTSET A B C if (R(B) <=> C) then R(A) := R(B) else PC++`
> 
> Used to implement and and or logical operators, or for testing a single
> register in a conditional statement.
> 
> For TESTSET, register R(B) is coerced into a boolean and compared to
> the boolean field C. If R(B) matches C, the next instruction is skipped,
> otherwise R(B) is assigned to R(A) and the VM continues with the next
> instruction. The and operator uses a C of 0 (false) while or uses a C value
> of 1 (true).

如果 B转换为 boolean后 和 C相等，则跳过下一条指令；否则将B赋给A然后继续执行。这条指令的目的是为短路求值服务的。那么`TESTSET`怎
么到后面变成了`TEST`呢？其过程就在`dischargejpc`->`patchlistaux`->`patchtestreg`。

上面我们说到`luaK_patchtohere`将待定`JMP`改成当前pc的功能，其实并不是直接修改的，而是通过每次生成新的字节码的时候，调用`dischargejpc`实现的，patch 的时候只是将这个位置串起来，然后 `dischargejpc`会便利这个链表进行修改
```
patchlistaux(fs, fs->jpc, fs->pc, NO_REG, fs->pc);
```
除此之外，`patchlistaux`还进行的一项操作就是`patchtestreg`，它的作用就是处理`TESTSET`，

```
131	static int patchtestreg (FuncState *fs, int node, int reg) {
132	  Instruction *i = getjumpcontrol(fs, node);
133	  if (GET_OPCODE(*i) != OP_TESTSET)
134	    return 0;  /* cannot patch other instructions */
135	  if (reg != NO_REG && reg != GETARG_B(*i)) // 前者表示不需要寄存，后者两者相同的话也是不需要修改的
136	    SETARG_A(*i, reg);
137	  else  /* no register to put value or register already has the value */
138	    *i = CREATE_ABC(OP_TEST, GETARG_B(*i), 0, GETARG_C(*i)); // 对于不需要返回值的情况，直接修改为 TEST
139	
140	  return 1;
141	}
```

上面的介绍只是 条件语句的一部分，后面的文章会对短路求值，compare 运算符等做解释。
