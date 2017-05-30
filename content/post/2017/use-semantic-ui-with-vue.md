+++
date = "2017-05-30T17:03:21+08:00"
description = ""
draft = false
tags = ["vue", "semantic-ui"]
title = "在 vue 中使用 semantic-ui"
topics = []

+++

[Vue](https://cn.vuejs.org/) 是一个很好呀的 MVVM 框架，我最近在一个内部使用的管理后台初次使用。而 [semantic-ui](https://semantic-ui.com/) 则是
一个比较美观全面的 css 框架，也是我比较偏好使用的。所以，在这次重构管理后台时，这两者就被我选择使用。PS： 服务器端用的是 [Django](https://www.djangoproject.com/)，
也是第一次使用。

semantic-ui 大部分情况下使用其 css 部分是没问题的，如 [button](https://semantic-ui.com/elements/button.html), [table](https://semantic-ui.com/collections/table.html)
等，直接套用对应的 css 样式即可。但是对于某些需要 js 初始化的控件，如 [dropdown](https://semantic-ui.com/modules/dropdown.html), [popup](https://semantic-ui.com/modules/popup.html)
等，都需要调用对应的函数，如
```
$('.ui.dropdown')
  .dropdown()
;
```
那么对于 Vue 中动态生成的控件要怎么处理呢？ 我们希望在控件加入到 dom 后能够调用对应的 semnatic-ui 初始化函数，但是由于 Vue 的插入是自动完成的，我们不好判断时机，好在 Vue 提供了
[自定义指令](https://cn.vuejs.org/v2/guide/custom-directive.html)，我们可以按照下面的方法来做：

首先假设我们的 html 是：
```html
<div id="main"></div>
```
然后 Vue 实例为：
```
let data = {
    data: ["Male", "Female"]
}
new Vue({
    el: "#main",
    data,
    template: `
    <select class="ui dropdown">
        <option value="">Gender</option>
        <option v-for="(v, k) in data" :value="k">{{ v }}</option>
    </select>
    `
})
```
这里我们以 dropdown 控件为例，按照以往的做法，我们此时可以调用`$(".ui.dropdown").dropdown()`来处理，但是对于 Vue 则可以使用自定义指令。假设我们定义一个指令名为`v-sudropdown`，
然后将其加到 `select` 中，于是变为`<select class="ui dropdown" v-sudropdown>`，那这个 directive 该怎么写呢：

```js
Vue.directive ("sudropdown", {
        inserted: el => $(el).dropdown({})
    })

```
其中，`inserted` 是一个钩子函数，一旦带有这个 `directive` 的元素被插入到 dom 时，这个钩子函数会被调用，从而完成我们的初始化操作。这样 vue 和 semantic-ui 就能完美共存了。