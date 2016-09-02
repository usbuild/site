+++
date = "2016-09-02T09:41:17+08:00"
description = ""
draft = false
tags = ["hugo", "mathjax", "viz"]
title = "Hugo 集成 Mathjax和graphviz"
plugins = ["mathjax", "viz"]

+++

[hugo](https://gohugo.io/)是一个比[hexo](https://hexo.io)更简单易用的静态页面生成工具，其只有一个可执行文件，部署环境简单，本博客就是基于hugo构建的。

我们在写博客的时候经常应用到公式和图表，这分别可以使用[mathjax](https://www.mathjax.org/)和[viz.js](https://github.com/mdaines/viz.js)实现。hugo并没有提供
内置的支持，所以需要我们自己写相关的支持。

由于并不是所有的文章都需要mathjax和viz.js，所以需要按需使用，这个可以在每个post的前言上定义`plugins`变量，如下
```
title = "Hugo 集成 Mathjax和graphviz"
plugins = ["mathjax", "viz"]
```
然后再`partials`目录下添加一个`post_plugins.html`，并在`post/single.html`引入这个文件：

```
  {{ partial "post_plugins.html" . }}
```

`post_plugins.html`文件内容如下：
```
{{ if isset .Params "plugins" }}
    {{ range .Params.plugins }}
        {{ $path := . | printf "post_plugins/%s.html"}}
        {{ partial $path }}
    {{ end }}
{{ end }}
```
逻辑即通过便利`plugins`参数内容，然后引入对应的html文件。在目前的这个例子中，我们使用了mathjax和viz。其中`post_plugins/mathjax.html`的内容如下：
```
<script type="text/javascript" src="//cdn.bootcss.com/mathjax/2.6.1/MathJax.js?config=TeX-AMS-MML_HTMLorMML"> </script>
<script type="text/x-mathjax-config">
MathJax.Hub.Config({
  tex2jax: {
    inlineMath: [['$','$'], ['\\(','\\)']],
    displayMath: [['$$','$$'], ['\[','\]']],
    processEscapes: true,
    processEnvironments: true,
    skipTags: ['script', 'noscript', 'style', 'textarea', 'pre'],
    TeX: { equationNumbers: { autoNumber: "AMS" },
         extensions: ["AMSmath.js", "AMSsymbols.js"] }
  }
});
MathJax.Hub.Queue(function() {
  var all = MathJax.Hub.getAllJax(), i;
  for(i = 0; i < all.length; i += 1) {
      all[i].SourceElement().parentNode.className += ' has-jax';
  }
});
</script>
```
这样我们就能使用`\$`或`\$\$`来编写公式了，最终示例表现如下：
$$ \[ \left [ &#8211; \frac{\hbar^2}{2 m} \frac{\partial^2}{\partial x^2} + V \right ] \Psi = i \hbar \frac{\partial}{\partial t} \Psi \]$$

对于`post_plugins/viz.html`内容如下：
```
<script type="text/javascript" src="//cdn.bootcss.com/viz.js/1.3.0/viz.js"> </script>
<script type="text/javascript">
(function(){
    Array.prototype.forEach.call(document.querySelectorAll("[class^=language-viz-]"), function(x){
        var engine;
        x.getAttribute("class").split(" ").forEach(function(cls){
            if (cls.startsWith("language-viz-")) {
                engine = cls.substr(13);
            }
        });
        var image = new DOMParser().parseFromString(Viz(x.innerText, {format:"svg", engine:engine}), "image/svg+xml");
        x.parentNode.insertBefore(image.documentElement, x);
        x.style.display = 'none'
    });
})();
</script>
```
代码的作用，就是将codeblock类型为language-viz-xxx的自动渲染为svg图像显示，以下是示例：


原始内容：

```
    ```viz-dot
    digraph g { a -> b; }
    ```

```

输出结果：

```viz-dot
    digraph g { a -> b; }
```

同理，对于其他需要特殊支持的格式或表现，都可以通过添加post_plugins来实现。以上代码都在本网站的[github](https://github.com/usbuild/site.git)上。