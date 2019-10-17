+++
draft = true
tags = ["network"]
topics = ["network"]
description = ""
title = "从零开始构建虚拟局域网"
date = "2019-10-16T20:10:00+08:00"
+++

本文从一个Demo出发，介绍了如何构建一个虚拟的跨多机器的局域网，用于加深对Docker网络的理解。

## 目标

要在两台物理机 `192.168.50.6` 和 `192.168.50.6`上构建几个虚拟网络接口，这些网络接口处于 `10.5.0.0/16`网段，并且支持互相访问，
如下所示：

```
+--------------------+ +---------------------+
|    192.168.50.6    | |    192.168.50.5     |
| +----------------+ | | +-----------------+ |
| |                | | | |                 | |
| |    10.5.0.21   | | | |   10.5.0.31     | |
| |                | | | |                 | |
| +----------------+ | | +-----------------+ |
|                    | |                     |
| +----------------+ | +---------------------+
| |                | | 
| |    10.5.0.11   | |
| |                | |
| +----------------+ |
|                    |
+--------------------+
```

## 桥接

Linux 提供了桥接以实现将多个网络接口连接起来的方法，其功能类似于一个交换机，只不过这个交换机可以工作在三层网络，可以拥有自己的 IP 地址。
创建网桥的命令如下
```
ip link add virbr0 type bridge
```
网桥也需要一个IP地址作为网关
```
ip addr add 10.5.0.1/16 dev virbr0
```
可以使用`ip addr`查看分配结果

## veth
现在有了网桥，我们还需要创建两个虚拟接口用于分配`10.5.0.0/16`网段的IP。 linux 提供了 [veth](http://man7.org/linux/man-pages/man4/veth.4.html)类型
的设备，它是两个互相连接的二层网络接口，可以理解为一根网线，从一个接口发送的数据会从另一个接口接收到。这里我们创建两条这样的“网线”。
```
ip link add veth10 type veth peer name veth11
ip link add veth20 type veth peer name veth21
```

为了构建一个局域网，需要将这两条网线插到网桥上去，命令如下
```
ip link set veth10 master virbr0
ip link set veth20 master virbr0
```

将这些虚拟网络接口拉起来
```
ip link set virbr0 up
ip link set veth10 up
ip link set veth20 up
```
现在我们的虚拟局域网的结构就已经完成了。

## network namespace
为了支持网络虚拟化，Linux提供了网络命名空间的概念。如果两个进程在不同的网络空间里，那么这两个进程所看到的网络设备、路由表、iptables规则等都是不一样的。该
机制提供了网络的隔离。为了方便管理，我们将上面构建的两个虚拟网口放到不同的网络空间里面去。
首先创建两个命名空间：
```
ip netns add ns1
ip netns add ns2
```
分别放入虚拟接口
```
ip link set veth11 netns ns1
ip link set veth21 netns ns2
```
这样如果直接输入`ip link`结果是看不到`veth11`和`veth22`的。如果要查看的话需要执行
```
➜  ~ ip netns exec ns1 ip addr
1: lo: <LOOPBACK> mtu 65536 qdisc noop state DOWN group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
17: veth11@if18: <BROADCAST,MULTICAST> mtu 1500 qdisc noop state DOWN group default qlen 1000
    link/ether fa:06:fe:c7:c6:e3 brd ff:ff:ff:ff:ff:ff link-netnsid 0
```

完成设置后启动虚拟网口
```
ip netns exec ns1 ip link set veth11 up
ip netns exec ns2 ip link set veth21 up
```
并设置IP
```
ip netns exec ns1 ip addr add 10.5.0.11/16 dev veth11
ip netns exec ns2 ip addr add 10.5.0.21/16 dev veth21
```
这样就可以ping通网关(`10.5.0.11`)了
```
➜  ~ ip netns exec ns2 ping 10.5.0.1
PING 10.5.0.1 (10.5.0.1) 56(84) bytes of data.
64 bytes from 10.5.0.1: icmp_seq=1 ttl=64 time=0.121 ms
64 bytes from 10.5.0.1: icmp_seq=2 ttl=64 time=0.084 ms
64 bytes from 10.5.0.1: icmp_seq=3 ttl=64 time=0.083 ms
```
接下来加上默认路由表
```
ip netns exec ns1 ip route add default via 10.5.0.1 dev veth11
ip netns exec ns2 ip route add default via 10.5.0.1 dev veth21
```
我们尝试
```
ip netns exec ns1 ping 192.168.50.5
```
会发现并不通， Why？原因在于我们的网络是`10.5.0.0/16`而对方的网络是`192.168.50.0/24`，linux默认不会转发
跨网络的包。可以通过以下命令来让Linux转发跨网络的包，表现得更加像一个路由器：
```
echo 1 > /proc/sys/net/ipv4/ip_forward
```
再次ping，发现还是不通。通过在物理网口(enp1s0)上抓包
```
➜  ~ tcpdump -i enp1s0 icmp
tcpdump: verbose output suppressed, use -v or -vv for full protocol decode                 
listening on enp1s0, link-type EN10MB (Ethernet), capture size 262144 bytes                
22:37:08.725785 IP 10.5.0.11 > 192.168.50.5: ICMP echo request, id 20576, seq 1, length 64 
22:37:09.731337 IP 10.5.0.11 > 192.168.50.5: ICMP echo request, id 20576, seq 2, length 64
```
发现ping没有回包，原因在于对方受到包后并不知道`10.5.0.11`这个ip地址在哪里，因为这是本机(192.168.50.6)上的私有网络。

## (S)NAT
网络包从一个私有网络到一个公有网络需要做网络地址转换(NAT)，在上面情况下，需要将`10.5.0.11`修改成`192.168.50.6`，然后
Linux内部再维持这样的一个映射，从而能将外面的回包转换回来。这种将包源地址修改的操作，叫做SNAT，可用 iptables 来实现：
```
iptables -t nat -A POSTROUTING -s 10.5.0.0/16 ! -o virbr0 -j SNAT --to-source 192.168.50.6
```
我们这里不讲 iptables 相关的知识，更多内容可以自行查找。

SNAT有一个变种，可以根据网络配置自动决定 `--to-source`的地址，即填写 enp1s0 上的地址。
```
iptables -t nat -A POSTROUTING -s 10.5.0.0/16 ! -o virbr0 -j MASQUERADE
```

By the way，如果想要暴露私有网络中的一个网络端口，则可以使用DNAT，
```
iptables -t nat -A PREROUTING -p tcp --dport 8765 -j DNAT --to-destination 10.5.0.11:8765
```
那么在其他机器上就可以通过`192.168.50.6:8765`来访问内部地址。这也是路由器中[端口映射](https://www.asus.com/support/FAQ/114093/)的一般做法。

## TUN/TAP
通过NAT、Bridge、Network Namespace我们已经构建了单机的网络，现在我们要实现跨物理机的虚拟网，也就是(V_P_N)。

Linux提供了`TUN/TAP`子系统来实现自定义网络设备。使用`TUN/TAP`可以创建一个虚拟接口tun或者tap，其中tun是三层设备而tap是二层设备。内核向这些设备
写入数据的时候会回调到用户态程序中，用户态程序可以自行决定如何处理这些网络数据包；同样程序也可以通过接口写入数据包，这样内核会感知到读事件。因此
就可以使用软件的方式来模拟包的传输过程。

由于我们需要连接两个局域网，需要处理如ARP之类的请求，因此需要创建一个二层设备(tap)。
```
ip tuntap add vtap0 mode tap
```
同样，将这个 `vtap0` 桥接到`virbr0`上。
```
ip link set virbr0 master virbr0
```

按照上面类似的做法，需要在`192.168.50.5`中创建虚拟网络(virbr0, veth30, veth31, vtap0)，并配置好相应的ip地址、路由表、SNAT。

接下来就是要将这两个物理机上的vtap0互相连接起来，这需要编程了。好在网络上有[示例](https://gist.github.com/makcuk/381a218f5e395b543d08)，可以直接拿来用：
```python
import fcntl
import struct
import os
import socket
import threading
import sys

TUNSETIFF = 0x400454ca
TUNSETOWNER = TUNSETIFF + 2
IFF_TUN = 0x0001
IFF_TAP = 0x0002
IFF_NO_PI = 0x1000


def udp_send(dst, packet):
    print "udp_send"
    sock.sendto(packet, (dst, 40000))

def recv():
     ss = socket.socket(socket.AF_INET, socket.SOCK_DGRAM) 
     ss.bind(("0.0.0.0", 40000))
     while True:
         data, addr = ss.recvfrom(1024)
         print "udp_recv"
         os.write(tun.fileno(), data)

if __name__ == "__main__":

    if len(sys.argv) < 3:
        print "Usage: tap-linux.py <tap_interface> <dst_address_of_tunnel>"
        sys.exit(1)
    iface = sys.argv[1]
    dst = sys.argv[2]
    print "Working on %s inteface, destination address %s:40000 udp" % (iface, dst)
    tun = open('/dev/net/tun', 'r+b')
    ifr = struct.pack('16sH', iface, IFF_TAP | IFF_NO_PI)
    fcntl.ioctl(tun, TUNSETIFF, ifr)
    fcntl.ioctl(tun, TUNSETOWNER, 1000)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM) # UDP
    t = threading.Thread(target=recv)
    try:
        t.start()
        while True:
            packet = os.read(tun.fileno(), 2048)
            if True:
                udp_send(dst, packet)

    except KeyboardInterrupt:
        print "Terminating ..."
        os._exit(0)
```
接下来只需要在`192.168.50.5`上执行
```
python linux-tap.py vtap0 192.168.50.6
```
在`192.168.50.6`上执行
```
python linux-tap.py vtap0 192.168.50.5
```
就可以了。

该程序的主要功能主要是：开启两个线程，一个用于接收40000端口的数据，然后写到tap中；一个用于从tap中读取数据，然后写入到远程进程的40000端口中去。中间的通信过程采用了
UDP协议，这也是正常的，因为以太网数据包本身就是不可靠的。

通过上面的一番操作，我们的网络就已经构建完成了，成功模拟了Docker中的[Bridge](https://docs.docker.com/network/bridge/)和[Overlay](https://docs.docker.com/network/overlay/) Network的功能。

## 接下来
在最新的Linux版本中，引入了如Macvlan/Macvtap/Ipvlan之类新的网络设备，其功能主要是将上述中的Bridge操作简化，接下来有时间可以慢慢解释这些网络设备的应用吧。