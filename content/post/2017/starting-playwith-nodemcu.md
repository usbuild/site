+++
date = "2017-08-21T20:14:01+08:00"
description = ""
draft = false
tags = ["nodemcu"]
title = "入手 NodeMCU 及初步体验"
topics = []

+++

最近刷微博看到有人提到 [NodeMCU](http://www.nodemcu.com/)， 网上一查才发现其实是类似于 [Arduino](https://www.arduino.cc/)的开发板，不过
它使用 lua 作为开发语言，相对于 micropython 其占用内存更小，语言的核心库也很简单。 同时，NodeMCU 集成了 [ESP8266](http://espressif.com/zh-hans/products/hardware/esp8266ex/overview)
这种廉价的 WIFI 芯片，使得其支持一定的网络功能。去淘宝搜索一下

<center><img src="/img/2017/nodemcu/taobao-search-nodemcu.png" width="450px"></center>

价格也是非常便宜。我随便找了一家店铺买了两个，总共不到 40 块钱。

最终到手就是这个啦：
<center><img src="/img/2017/nodemcu/nodemc-board.png" width="450px"></center>


这块板子直接支持 microUSB 接口，不用自己使用 USB-TTL 来连了，省了不少麻烦。连接电脑后（注意有些USB线只支持充电，我找了两条线都用不了，换了第三根数据线才脸上），会自动安装
驱动，系统会显示多了一个 COM 口。

<center><img src="/img/2017/nodemcu/devicemanager.png" width="450px"></center>

连接上电脑后第一件事就是刷机，这里是固件的地址 [https://github.com/nodemcu/nodemcu-firmware](https://github.com/nodemcu/nodemcu-firmware)， 当然你也可以刷 
[MicroPython](https://docs.micropython.org/en/latest/esp8266/esp8266/tutorial/intro.html)。由于固件编译环境比较麻烦，所以有爱好者做了一个在线编译的网站 
[https://nodemcu-build.com/](https://nodemcu-build.com/)，你可以选择分支和模块，实现定制。提交任务后，当它开始编译和结束编译的时候会发送邮件给你留下的邮箱。同时，会推荐一个
 flash 工具，其实就是 pyflasher 的 GUI 版，你可以下载下来使用。接下来启动这个工具：

 <center><img src="/img/2017/nodemcu/pyflash.png" width="450px"></center>

 由于我买的这个板存储超过4M，所以选择的是 DIO 模式，同时由于是第一次使用，所以直接选择清除所有数据。刷机很快，不到1min。之后就可以使用啦。

 IDE 我选择的是[ESPlorer](https://esp8266.ru/esplorer)，它同时支持 lua 和 MicroPython 编程。打开主界面后直接点击右上角的 Connect 就可以了，然后按一下板子上的
 RST 按钮就能进入 lua 的 REPL 环境了。可以在下面输入 lua 代码执行，就跟普通的 lua 交互式环境一样。下面是如何连接 wifi 的代码
 ```lua
wifi.setmode(wifi.STATION)
wifi.sta.config({ssid="SSID_NAME", pwd="PASSWORD"})
 ```
 其中 wifi 是一个内置模块，所有的内置模块都可以在编译的时候选中，模块的使用文档：[https://nodemcu.readthedocs.io](https://nodemcu.readthedocs.io)。 比如说想获取某个网址的内容：
 ```lua
http.get("http://baidu.com", nil, function(code, data)
    print(code, data)
end)
 ```
NodeMCU 采用了一种事件触发模型，所以很多这种回调函数，类似于 Node.js。

NodeMCU 提供了很多 GPIO 口，使得它成为 IoT 开发的首选方案，可以连接各种传感器。我尝试了一下温度传感器 DHT11 模块，商家直接封装好了，不用自己再接上拉电阻了。如果直接通过编程来读取
温度和湿度是比较麻烦的，好在内置模块提供了 DHT 模块，只要在编译的时候包含进去就可以。最后代码如下(从文档摘取的)，其中 5 是信号输入源：
```lua
pin = 5
status, temp, humi, temp_dec, humi_dec = dht.read(pin)
if status == dht.OK then
    -- Integer firmware using this example
    print(string.format("DHT Temperature:%d.%03d;Humidity:%d.%03d\r\n",
          math.floor(temp),
          temp_dec,
          math.floor(humi),
          humi_dec
    ))

    -- Float firmware using this example
    print("DHT Temperature:"..temp..";".."Humidity:"..humi)

elseif status == dht.ERROR_CHECKSUM then
    print( "DHT Checksum error." )
elseif status == dht.ERROR_TIMEOUT then
    print( "DHT timed out." )
end
```

除了尝试 DHT11 模块外，还试了一下超声波模块 HC-SR04， 这个是通过向 Trig 端输出一段高电平信号，然后通过 Echo 端来检测高电平，高电平的持续时间就是超声波传输的时间，然后根据
空气中的声速就能计算出来了。好在也有人提供了一个开源代码 [https://github.com/sza2/node_hcsr04/](https://github.com/sza2/node_hcsr04/)。但是实际使用并没有那么简单。
我们来看看他的代码：
```lua
function self.echo_cb(level)
    if level == 1 then
        self.time_start = tmr.now()
        gpio.trig(self.echo, "down")
    else
        self.time_end = tmr.now()
    end
end

function self.measure()
    gpio.trig(self.echo, "up", self.echo_cb)
    gpio.write(self.trig, gpio.HIGH)
    tmr.delay(100)
    gpio.write(self.trig, gpio.LOW)
    tmr.delay(100000)
    if (self.time_end - self.time_start) < 0 then
        return -1
    end
    return (self.time_end - self.time_start) / 5800
end
```
逻辑很简单，先是通过监听低到高转换的信号，记录时间同时监听高到地的信号，记录时间，这个时间差值就是超声波的传输时间。但是由于超声波的速度很快，很有可能你在设置 down
事件之前已经触发了，导致迟迟无法获取结束信号。所以可以稍作改动
```lua
function self.echo_cb(level)
    if level == 1 then
        self.time_start = tmr.now()
    else
        self.time_end = tmr.now()
    end
end
function self.measure()
    gpio.trig(self.echo, "both", self.echo_cb)
    gpio.write(self.trig, gpio.HIGH)
    tmr.delay(100)
    gpio.write(self.trig, gpio.LOW)
    tmr.delay(100000)
    if (self.time_end - self.time_start) < 0 then
        return -1
    end
    return (self.time_end - self.time_start) / 5800
end
```
然后发现部分能正常使用了，但是对于短距离的测量还是会丢失结束信号，猜想可能是在代码执行过程中事件到来，结果没能来得及处理，所以只能采取比较老土的方案了，不使用事件驱动，直接读
```lua
function self.measure()
    gpio.write(self.trig, gpio.HIGH)
    tmr.delay(100)
    gpio.write(self.trig, gpio.LOW)
    gpio.mode(self.echo, gpio.INPUT)
    gpio.write(self.echo, gpio.LOW)
    local start_time, end_time
    local gread = gpio.read
    local tnow = tmr.now
    local echo = self.echo
    local wdclr = tmr.wdclr
    while gread(echo) == 1 do
        start_time = tnow()
        wdclr()
    end
    while gread(echo) == 0 do
        end_time = tnow()
        wdclr()
    end
    return (end_time - start_time) / 5800
end
```
最终的效果还不错，对于几厘米的距离也能有很好的分辨率。

总的来说， NodeMCU 的可玩性非常强，比如说可以通过网络和继电器实现家庭电器开关的控制啦，简直就是硬件版的 IFTTT，相比于树莓派，价格够便宜，简直就是折腾智能家庭的神器。