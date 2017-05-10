+++
date = "2017-04-29T15:38:38+08:00"
description = ""
draft = false
tags = ["meta-programming", "C++"]
title = "使用C++ map实现注册回调的功能"
topics = []

+++

在`C++/lua`混合编程中，往往存在需要回调的情况。比如在游戏中，逻辑进程中的脚本需要一个数据库访问操作，如下:

```lua
dbmgr.query({name="hello"}, function(ret)
-- do something
end)
```
由于`dbmgr.query`是异步操作，这条语句是立即返回的。内部执行过程中是通过向`dbmgr`进程发送一个`query`请求，然后逻辑进程继续执行。当`dbmgr`收到请求后，其执行数据库查询操作，得到
结果然后也是通过网络将其发送给逻辑进程。逻辑进程收到结果后调用到`lua`的回调函数里。

这里有一个简化方案，如果时仅仅针对`lua`的话，只需要在向`dbmgr`进程发送请求的时候带上`lua function`的注册ID就好了，查询到结果后返回过来就能直接调用。但是我们希望这个接口不仅仅在
`lua`中使用，希望在`C++`中也能调用，并且希望提供一个统一的模块来负责这类事情，该如何设计？一个简化后的问题如下：

```
#include <functional>
#include <map>

std::map<int, std::function<void(void*)>> callbacks;
int last_idx = 0;

//用于注册回调函数，需要支持各种function
template<typename T>
int addCallback(T && t) {
}

//用于调用回调函数
template<typename ... ARGS>
void call(int idx, ARGS && ... args) {
}

void func(int i) {}

class Functor {
public:
	void operator()(const std::string &s, int i) {}
};

int main() {
	int c1 = addCallback(&func);
	int i;
	int c2 = addCallback([i](double j) {});
	int c3 = addCallback(Functor());

	call(c1, 1);
	call(c2, 1.0);
	call(c3, std::string("string"), 1);

	return 0;
}
```

其中`addCallback`的作用用于注册回调函数，参数可以是`std::function`、`lambda`、`functor`、普通的函数、成员函数等等。这里为了简化处理，我们只
处理`std::function`、`lambda`和普通函数，其余的不再赘述。下面是一些问题：

# 参数的处理？
由于我们使用的是`map`，`value_type`是一定的，你无法将多个不同类型的`std::function`放进去，所以需要需要包一层，这里存储的是`std::function<void(void*)>`，
由于是异步调用，返回值我们不关心。参数使用的是`void*`，将类型给抹除掉了。那么参数的具体内容是什么呢？可以使用`std::tuple`来存储，那`call`的实现就很简单了:


```
template<typename ... ARGS>
void call(int idx, ARGS && ... args) {
	auto it = callbacks.find(idx);
	if (it != callbacks.end() {
		auto tuple = std::tuple<ARGS...>(args...);
		it->second(&tuple);
	}
}
```

# `callbacks`存储的内容是？

上面的讨论中，`map`的`value_type`是`std::function<void(*)>`，所以我们不能直接将外部传入的回调设置进去，需要再包一层
```
template<typename T>
int addCallback(T && t) {
    last_idx++;
    callbacks[last_idx] = [t](void *data){
        auto ptr = static_cast<std::tuple<...> *>(data); // 模板参数怎么处理？
        std::apply(t, *ptr);
    };
}
```
这里我们使用了`C++17`中的[std::apply](http://en.cppreference.com/w/cpp/utility/apply)，其作用就是调用函数，参数是一个`tuple`，有兴趣的可以从源码中看看`apply`的实现，
这里就不详细介绍了。
问题是，`tuple`的参数如何处理？我们没法从`data`中得到类型心系，唯一的方法就是从`T`中获取，那如何获取呢？

# callable对象调用参数萃取

现在的主要问题是，如何从`std::function`、`lambda`、普通函数等类型中提取参数信息。对于普通函数和`std::function`我们可以通过特化来做

```
template<typename T>
struct CallbackTypeHelper;

template<typename RET, typename ... ARGS>
struct CallbackTypeHelper<RET(*)(ARGS...)> {
    typedef std::tuple<ARGS...> typle_type;
}

template<typename RET, typename ... ARGS>
struct CallbackTypeHelper<std::function<RET(ARGS...)>> {
    typedef std::tuple<ARGS...> typle_type;
}
```
对于`lambda`该如何处理呢？

`lambda`作为`C++11`中新引进的特性，其作用是实现一个匿名函数，由于捕获组的存在，其不能仅仅实现成一个`C Function`。为了实现这个目的，编译器会生成一个匿名类，各个捕获参数即为成员
变量，为了实现可被调用，其重载了`operator()`。根据这个思路，我们找到了获取参数的方法：

```
template<typename T>
struct CallbackFunctorHelper;

template<typename RET, typename C, typename ... ARGS>
struct CallbackFunctorHelper<RET(C::*)(ARGS...) const> {
  typedef std::tuple<ARGS...> tuple_type;
};

template<typename RET, typename C, typename ... ARGS>
struct CallbackFunctorHelper<RET(C::*)(ARGS...)> {
  typedef std::tuple<ARGS...> tuple_type;
};

template <typename T, typename Enabled=void>
struct CallbackTypeHelper {
  typedef typename CallbackFunctorHelper<decltype(&std::decay<T>::type::operator())>::tuple_type tuple_type;
};

```
注意由于参数有可能是引用，所有这里需要[decay](http://en.cppreference.com/w/cpp/types/decay)来处理这些引用。同时由于`lambda`的`mutable`属性的存在，所以`CallbackFunctorHelper`
需要`const`和`non-const`的特化。


最后，由于这只是演示性质的代码，有些逻辑如成员函数等并没有考虑进去，除此之外，可以使用`enable_if`做个单独的特化，而不需要在默认函数上写`functor`的实现等。在实际
应用中可以修改得更加全面和优雅。
