+++
date = "2016-09-06T22:08:20+08:00"
description = ""
draft = true
tags = ["Linux", "ELF"]
title = "Linux下动态链接库延迟绑定介绍"
plugins = ["viz"]

+++

在编译动态链接库时，为了保证能被正常使用，一般我们会加上-fPIC参数。在使用的动态链接库中的函数时，Linux使用了一种
叫延迟绑定的技术实现运行时的symbol relocation。其中的关键就是GOT(Global Offset Table)和PLT(Procedure linkage Table)。下面就
这一技术的实现简单解释一下。