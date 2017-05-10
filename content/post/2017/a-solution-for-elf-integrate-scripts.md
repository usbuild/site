+++
date = "2017-05-01T22:30:00+08:00"
description = ""
draft = false
tags = ["elf", "lua"]
title = "一种在elf中集成脚本文件的方案"
topics = []

+++

进行游戏服务器开发时，我们将`C++`的部分称之为引擎层，而`lua`称之为脚本层。但是往往有些核心逻辑是各个游戏公用的，
或者说有些引擎层的代码用`C++`写起来十分麻烦，我们还是会使用`lua`来编写。这就带来了一些问题，我们的游戏目录结构如下:

```
├─bin               // 可执行文件
└─scripts           // 脚本目录，lua文件
    ├─framework     // 核心lua文件，各个项目公用的
    └─server        // 游戏逻辑lua文件
```

其中`scripts/framework`是各个项目公用的，并且和`bin`目录中的可执行文件同时发布和更新。所以有一个想法，就是将`framework`中
的lua文件集成到可执行文件中，减少维护的成本。

#  文件存储

下面是elf文件的示意图

![elf](https://upload.wikimedia.org/wikipedia/commons/thumb/7/77/Elf-layout--en.svg/260px-Elf-layout--en.svg.png)

elf文件有多个section，除了一些预定义的section如`.rodata`、`.text`、`.init`等，我们也可以定义一些自己的section。所以我们可以将所需要的lua文件
放进这个section中，在执行的时候动态读出来，实现目的。我们可以使用[objcopy](https://linux.die.net/man/1/objcopy)命令来实现创建自定义section的功能。

```
objcopy infile.out --add-section .lua-data=section_file outfile.out
```

然而`framework`里面有多个文件，而且包含嵌套的文件夹，我们需要一个将文件夹变成单个文件的功能，类似于[tar](https://linux.die.net/man/1/tar)。虽然创建
section时使用`tar`命令是简单的，但是在读取的时候需要一些第三方的库来支持，这是比较麻烦的。而由于我们的目录中只包含`lua`文件，所以可以简化设计。
首先空文件夹对于我们是无意义的，只需要`lua`文件就可以。所以最终我们得到如下的表:

```
┌────────────────────┐
│ libs/json.lua      │
├────────────────────┤
│ core/entity.lua    │
├────────────────────┤
│ app/game.lua       │
├────────────────────┤
│ libs/bson.lua      │
└────────────────────┘
```
我们可以按照如下的格式转换成单个文件

```
┌────────┬───────────┐
│name_len│content_len│
├────────┴───────────┤
│ core.entity        │
├────────────────────┤
│name_len│content_len│
├────────────────────┤
│ libs.bson          │
├────────────────────┤
│ .................  │
└────────────────────┘
```
其中`name_len`为文件名的长度，这里直接转换成了lua中`require`的格式，使用点符号。`content_len`是文件内容的长度，即文件的具体内容长度。最后我们可以使用`zip`指令
将这部分内容压缩存储在`elf`文件中。完整的代码如下:

```python
#!/usr/bin/env python
#coding: utf-8

import os, struct, StringIO, zlib, subprocess, sys, tempfile, argparse

argParser = argparse.ArgumentParser()

argParser.add_argument("luafolder", type=str)
argParser.add_argument("exe", type=str)
argParser.add_argument("out", type=str)

args = argParser.parse_args()

files = []

path = args.luafolder

for (dirpath, dirname, filenames) in os.walk(path):
    dirp = dirpath[len(path):]
    if dirp:
        if dirp[-1] != "/":
            dirp += "/"

        while dirp[0] == "/":
            dirp = dirp[1:]

    files.extend([dirp + x for x in filenames])

output = StringIO.StringIO()

for fpath in files:
    realp = path + "/" + fpath
    filesize = os.path.getsize(realp)

    if fpath.endswith(".lua"):
        fpath = fpath[:-4]
    elif fpath.endswith(".luac"):
        fpath = fpath[:-5]
    else:
        continue

    package_pattern = fpath.replace("/", ".")
    package_pattern = "pg." + package_pattern
    with open(realp, "rb") as rf:
        content = rf.read()
        output.write(struct.pack("=hL", len(package_pattern), len(content)))
        output.write(package_pattern)
        output.write(content)

f = tempfile.NamedTemporaryFile()

outdata = output.getvalue()
f.write(struct.pack("=L", len(outdata)))
f.write(zlib.compress(output.getvalue()))
f.flush()

subprocess.call("objcopy %s --remove-section .lua-data"%(args.exe, ), shell=True)
subprocess.call("objcopy %s --add-section .lua-data=%s %s"%(args.exe, f.name, args.out), shell=True)

```

# 文件内容的读取
我们需要使用`elf.h`文件来读取文件内容。根据上述的格式示意图，`elf`文件开头的是Header，其格式为`ElfXX_Ehdr`，
我们可以直接读取文件内容到内存。然后读取`e_shoff`字段获得section header的位置，定位到位置并依次读取内容到`ElfXX_Shdr`
结构体中，然后通过各个entry的`sh_name`得到最终section，然后读取文件达到目的。完整代码如下：

```
static std::map<std::string, std::string> readElfLuaData(const std::string &filepath) {
    std::map<std::string, std::string> files;
#if __x86_64__
    typedef Elf64_Ehdr ELF_EHDR;
    typedef Elf64_Shdr ELF_SHDR;
#else
    typedef Elf32_Ehdr ELF_EHDR;
    typedef Elf32_Shdr ELF_SHDR;
#endif

    std::ifstream ifs(filepath);

    ELF_EHDR hdr;
    ifs.read(reinterpret_cast<char *>(&hdr), sizeof(hdr));

    std::vector<ELF_SHDR> sh_tables(hdr.e_shnum);
    ifs.seekg(static_cast<long>(hdr.e_shoff));

    for (size_t i = 0; i < hdr.e_shnum; ++i) {
        ifs.read(reinterpret_cast<char *>(&sh_tables[i]), sizeof(sh_tables[i]));
    }

    // read shstr

    std::vector<char> shstr(sh_tables[hdr.e_shstrndx].sh_size);
    ifs.seekg(static_cast<long>(sh_tables[hdr.e_shstrndx].sh_offset));
    ifs.read(shstr.data(), static_cast<long>(shstr.size()));

    ELF_SHDR *lua_sh = nullptr;

    for (size_t i = 0; i < hdr.e_shnum; ++i) {
        char *name = shstr.data() + sh_tables[i].sh_name;
        if (strcmp(name, ".lua-data") == 0) {
            lua_sh = &sh_tables[i];
            break;
        }
    }

    if (lua_sh) {
        std::vector<char> buf(lua_sh->sh_size);
        ifs.seekg(static_cast<long>(lua_sh->sh_offset));
        ifs.read(buf.data(), static_cast<std::streamsize>(buf.size()));

        size_t idx = 0;
#define READ_TO(TARGET, SIZE)                                                                      \
    memcpy(TARGET, buf.data() + idx, SIZE);                                                        \
    idx += SIZE;

        uint32_t raw_len = 0;
        READ_TO(&raw_len, sizeof(raw_len));

        std::vector<char> tmp(raw_len);
        uLongf dest_len = tmp.size();
        uncompress(reinterpret_cast<Bytef *>(tmp.data()), &dest_len,
                   reinterpret_cast<Bytef *>(buf.data() + idx), buf.size() - idx);

        buf.swap(tmp);
        idx = 0;

        while (idx < dest_len) {
            uint16_t name_len;
            uint32_t content_len;
            READ_TO(&name_len, sizeof(name_len));
            READ_TO(&content_len, sizeof(content_len));
            std::string filename(name_len, 0), content(content_len, 0);
            READ_TO(&*filename.begin(), filename.size());
            READ_TO(&*content.begin(), content.size());
            files.emplace(std::piecewise_construct, std::forward_as_tuple(std::move(filename)),
                          std::forward_as_tuple(std::move(content)));
        }
#undef READ_TO
    }
    return files;
}
```

接下来便可以通过添加到`package.preload`实现在lua中调用这些文件的目的。
