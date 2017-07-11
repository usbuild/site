+++
date = "2017-07-11T16:11:23+08:00"
description = ""
draft = false
tags = []
title = "使用 git bisect 进行debug"
topics = []

+++

最近在学习`git`的时候发现了一个有趣的命令，`git bisect`。这个命令是 debug 用的。我们往往在开发过程中引入一些bug，但是由于没能立即测试导致这些bug在很多次提交
之后才能被发现，但是这时候距离上次引入的bug可能过去了很长时间，难以复现了。如果我们使用svn的话，往往会不断地`svn update`到某个版本然后测试，为了提高搜寻
得效率往往会使用二分查找：在已知的功能正常的版本A和当前版本B找一个中间点C判断，如果C版本也是存在bug的话继续搜索AC区间，否则的话搜索CB区间。在 git 中，
这个操作可以被自动化，`bisect`指令就是专门用作这个的。

下面我来简单介绍一下这个用法。

假设有一个 git 库，使用如下的方式构建：
```
➜  test git init
Initialized empty Git repository in /home/zqc/workspace/test/.git/
➜  test git:(master) for i in {1..10}; do echo $i >> test.log; git add -A; git commit -m "commit $i"; done
[master (root-commit) cc9d416] commit 1
 1 file changed, 1 insertion(+)
 create mode 100644 test.log
[master 09576a2] commit 2
 1 file changed, 1 insertion(+)
[master 9cfabe6] commit 3
 1 file changed, 1 insertion(+)
[master f65497a] commit 4
 1 file changed, 1 insertion(+)
[master 6292639] commit 5
 1 file changed, 1 insertion(+)
[master 301e6fd] commit 6
 1 file changed, 1 insertion(+)
[master b440342] commit 7
 1 file changed, 1 insertion(+)
[master a4f2dea] commit 8
 1 file changed, 1 insertion(+)
[master 8d8ec0a] commit 9
 1 file changed, 1 insertion(+)
[master 474b493] commit 10
 1 file changed, 1 insertion(+)
```
其作用是初始化了一个git仓库，并提交了10次，每次豆香`test.log`文件末尾增加了一个数字。
所以`test.log`最终的内容是：

```
1
2
3
4
5
6
7
8
9
10
```
我们假设如果这个文件中所有数字的和超过`30`，那么这个程序就是有bug的，现在我们想判断是哪次提交导致和超过了`30`。

先要开始二分查找`git bisect start`。


现在我们处于HEAD处。此时和为`1 + 2 + ... + 10 = 55 > 30`，所以当前是有bug的，因此设置当前的这次提交为`bad`, `git bisect bad`
显然在第一次提交中，和为1，所以其应该是正常的`good`，因此设置第一次提交`git bisect good cc9d416`。

当我们敲下这条指令是，git会将当前的HEAD指针设置为：
```
➜  test git:(6292639) git rev-parse HEAD
6292639374ed862233630d2803031f9624e1fa0c
➜  test git:(6292639) git log -1
commit 6292639374ed862233630d2803031f9624e1fa0c
Author: usbuild <xxx@gmail.com>
Date:   Tue Jul 11 17:11:08 2017 +0800

    commit 5
```
可以看出是第5次提交，此时我们计算`test.log`和为`1 + 2 + .. + 5 = 15 < 30`，所以此次提交时好的，那么标识`git bisect good`。然后同上，git
将HEAD带到了第7次提交。同样`1 + 2 + ... + 7 = 28 < 30`，也是合法的，继续设置为`good`。然后到`9`，这时和已经超过`30`了，所以为`bad`。到`8`，也是`bad`。
这时，git会弹出搜索的结果：
```
a4f2deaa73f28dffe4cdfb72258d14815cacf185 is the first bad commit
commit a4f2deaa73f28dffe4cdfb72258d14815cacf185
Author: usbuild <xxx@gmail.com>
Date:   Tue Jul 11 17:11:08 2017 +0800

    commit 8

:100644 100644 06e567b11dfdafeaf7d3edcc89864149383aeab6 535d2b01d3397c2228490875defc92370602ca46 M      test.log
```
它标识处第8次提交引入了这个问题，这也正是符合实际的。

当找到这次提交之后，我们需要调用`git bisect reset`来恢复当前的工作区。至此查找工作完成。


虽然说在上述过程中我们不需要手动计算中间版本了，但是对于验证工作还是需要手动计算，稍显麻烦。其实如果有自动化测试脚本的话，`bisect`能自动帮我们找到问题的提交。
过程如下：
```
➜  test git:(master) git bisect start
➜  test git:(master) git bisect good cc9d416                                                                                      
➜  test git:(master) git bisect bad
```
指定范围后，我们可以使用`git bisect run <cmd>`来实现自动查找。当`<cmd>`返回值为`0`时，标识为`good`；否则为`bad`。这里我们写一个简单的判断脚本
```
➜  test git:(6292639) git bisect run python -c "assert(sum(int(x) for x in open('test.log', 'r').read().strip().split('\n')) <= 30)"
running python -c assert(sum(int(x) for x in open('test.log', 'r').read().strip().split('\n')) <= 30)
Bisecting: 2 revisions left to test after this (roughly 1 step)
[b4403425313b8e4a65c7278d2b51ecfcb5a767a3] commit 7
running python -c assert(sum(int(x) for x in open('test.log', 'r').read().strip().split('\n')) <= 30)
Bisecting: 0 revisions left to test after this (roughly 1 step)
[8d8ec0a7976a74d184602070fbe1c148cee49612] commit 9
running python -c assert(sum(int(x) for x in open('test.log', 'r').read().strip().split('\n')) <= 30)
Traceback (most recent call last):
  File "<string>", line 1, in <module>
AssertionError
Bisecting: 0 revisions left to test after this (roughly 0 steps)
[a4f2deaa73f28dffe4cdfb72258d14815cacf185] commit 8
running python -c assert(sum(int(x) for x in open('test.log', 'r').read().strip().split('\n')) <= 30)
Traceback (most recent call last):
  File "<string>", line 1, in <module>
AssertionError
a4f2deaa73f28dffe4cdfb72258d14815cacf185 is the first bad commit
commit a4f2deaa73f28dffe4cdfb72258d14815cacf185
Author: usbuild <xxx@gmail.com>
Date:   Tue Jul 11 17:11:08 2017 +0800

    commit 8

:100644 100644 06e567b11dfdafeaf7d3edcc89864149383aeab6 535d2b01d3397c2228490875defc92370602ca46 M      test.log
bisect run success
```
最终出来的结果和我们之前的判断是一样的，只不过减少了人工操作的麻烦。