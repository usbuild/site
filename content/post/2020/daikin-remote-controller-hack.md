+++
draft = false
tags = ["daily", "diy", "chip"]
topics = ["daily"]
description = ""
title = "成本2元！大金线控变遥控"
date = "2020-09-04T20:00:00+08:00"
+++

## 背景
去年入住新小区，开发商交付时自带大金1拖4中央空调，但是配备的是墙上线控，无法使用红外遥控。没有遥控也就没法实现远程控制
半夜关空调、调温度只能下床；同样也就无法使用米家万能遥控、空调伴侣等实现自动化的控制。想要实现到家前远程开空调、凌晨冷的时候
自动关空调的场景只能是一种奢望。


<center><img src="/img/2020/daikin/brc1e631.jpg" width="250px"><div class="imgtip">墙上线控</div></center>


## 方案
目前市面上有多重大金空调的远程控制方案，
* [官方远程控制器](https://www.daikin-china.com.cn/newha/products/4/19/DS-AIR/) 价格3000多，只需要一个就能控制四个室内机，需要使用官方的APP，比较难用。
* 绿米远程控制器 价格3000左右，只需要一个就能控制四个室内机，可以接入米家，目前只在线下销售。除此之外云起(LifeSmart)等厂商也提供类似的产品。
* 官方红外接收器 价格500，只需要加装在室内机上，需每个室内机都要配置一个。

<center><img src="/img/2020/daikin/brc4l631.jpg" width="250px"><div class="imgtip">红外接收器</div></center>
* 官方有线控制带红外 价格380左右，需要更换墙上控制器，但是其只能用于86面板，而大部分手操都是120面板，无法兼容
<center><img src="/img/2020/daikin/brc1h611.jpg" width="250px"><img src="/img/2020/daikin/brc1h611-r.jpg" width="250px"><div class="imgtip">简陋的遥控</div></center>

## 启发
在网上搜索，意外发现一个[链接](http://bbs.mydigit.cn/simple/?t303681.html)，该 作者使用单片机 + 红外遥控直接控制墙控面板上开关
的方案，感觉正符合我的需求。其主要思路如下：
1. 大金面板上的开关信号，其实是一个低电平信号，直接将对应的脚拉低即可模拟开关按下
2. 面板上直接提供了5V电源，因此很多单片机都可以直接使用。作者使用了Attiny 13 SOP-8 封装的
3. 使用红外遥控成本非常低，并且可以通过米家万能遥控间接实现远程控制

<center><img src="/img/2020/daikin/attiny13a.jpg" width="150px"><div class="imgtip">ATTiny13a</div></center>

## 改造过程
### atTiny13a
我首先购入了 atTiny13a 单片机，淘宝价格不到两块(我买的时候1.78)。该单片机属于8位MCU，拥有1KB Flash，64字节的EEPROM以及64字节的SRAM。
可直接使用5V电压，并且无需外部的时钟电路。选择的关键原因是其与 ATmega328p 一样同属 AVR 指令集，使用Arduino开发比较方便, 无需额外购买编程器。
atTiny13a 有8个针脚，除了VCC和GND外，其他的6个均可作为IO脚。一个脚给红外接收头，一个连接蜂鸣器，还有4个脚作为开关使用。这四个脚我是
分配给(开关、温度上、温度下、风量) 四个功能的，基本上够用。
我在网上搜到了使用红外遥控的[代码](https://blog.podkalicki.com/attiny13-ir-remote-to-control-leds-nec-proto/)，基本上能直接使用。功能设计上
与上面说的帖子类似
1. 长按按钮实现红外学习功能，红外码存储在EEPROM里面。
2. 按下遥控，对应的按钮给一个200ms的低电平，并且蜂鸣器发声。

硬件上面，红外接收器使用的是VS1838B，淘宝价格大概0.5元。蜂鸣器随便找了一个比较小的，5V有源蜂鸣器，淘宝价格0.75元。


<center><img src="/img/2020/daikin/front.jpg" width="350px"><div class="imgtip">开关</div></center>
<center><img src="/img/2020/daikin/back.jpg" width="350px"><div class="imgtip">接线</div></center>
当开始调试的时候，发现上面的红外识别代码总是有问题，为了方便我直接拿的家里的 TCL 电视遥控测试，找遍了网上的 NEC 红外协议说明，对照代码发现
不了问题。于是耗巨资(24元)购入逻辑分析仪一个，通过分析VS1838B的针脚信号，发现 TCL 遥控发出的并不是标准的 NEC 协议。更换了一个网上常见的
diy mp3 红外遥控器解决。


### 推倒重来
当单个按钮的功能调通后，我开始扩展到4个IO口。一开始我以为 atTiny13a 的 1KB Flash对于这么简单的一个程序是够用的，但是技不如人，无论怎么压缩
程序大小总是无法缩小到1KB以内，无奈只能另寻出路。Attiny 是一个系列，其最高配的ATTiny85拥有8KB的Flash以及512字节的EEPROM，绝对是够用了。但是
其价格近7块钱，7块钱我都能上ESP-12F之类的32位MCU了啊！这时我搜索SOP-8封装的MCU，发现了STC8G系列，其中的STC8G1K08A-36I-SOP8 正好是SOP-8封装的，
于是购入，淘宝价格大概0.8。
<center><img src="/img/2020/daikin/error.png" width="550px"><div class="imgtip">报错</div></center>

### STC8G
STC8G是STC最近推出的8位8051 1T内核的MCU。拥有8KB Flash， 4KB EEPROM，配置上比ATTiny85看起来还要好，加上8051入手比较简单，开发难度也比较小。
硬件与之前的保持一致，但是红外接收代码方面一直没有找到好的示例，因此不如自己写了。遇到一个比较坑的点是单片机不支持同时上升沿和下降沿中断,因此上面的
链接代码不能直接复用。EEPROM 的代码直接抄了DataSheet中的示例。最终代码在[这里](https://gist.github.com/usbuild/a059f9af17f3ea4d9b8ce37d0c9f386f)。
为了保证接收效果，最终把红外接收头放在了外面，在下图如果仔细看的话会发现贴在面板下面。
<center><img src="/img/2020/daikin/demo.gif" width="350px"><div class="imgtip">效果</div></center>

## 后续
由于空间有限，不得不选用比较小的MCU。 如果稍微大一点的话，我宁愿采用ESP8266，可以真正的接入WIFI，实现远程控制。并且还能通过一些第三方接口接入
小爱同学。不过好在这个程序可以复用，STC8G也支持比较宽的电压，后续如果有其他电器的改装需求也可以直接使用。从 atTiny13a 到 STC8G，国产有明显的
性价比优势，最终下来整个的改装成本不到2元，也算是以最小的成本达成了目的。
