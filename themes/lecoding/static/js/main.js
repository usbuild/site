window.addEventListener("load", function(){
    Array.from(document.querySelectorAll("a")).filter(e => e.href.indexOf("gist.github.com") > -1).forEach(a => {
        let icon = document.createElement("i");
        a.innerText = "GIST";
        icon.classList.add("fab");
        icon.classList.add("fa-github");
        a.prepend(icon);
        a.classList.add("gist");
    });
});
