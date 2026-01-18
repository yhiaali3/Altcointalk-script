(function () {
    try {
        document.addEventListener('click', function (ev) {
            try {
                const a = ev.target && ev.target.closest && ev.target.closest('a');
                if (a && a.target === '_blank') {
                    a.removeAttribute('target');
                }
            } catch (e) { }
        }, true);

        function fixExisting() {
            try {
                document.querySelectorAll('a[target="_blank"], form[target="_blank"]').forEach(function (el) { try { el.removeAttribute('target'); } catch (e) { } });
            } catch (e) { }
        }
        fixExisting();

        var mo = new MutationObserver(function (muts) {
            try {
                muts.forEach(function (m) {
                    m.addedNodes && m.addedNodes.forEach(function (n) {
                        try {
                            if (n.nodeType === 1) {
                                if (n.matches && n.matches('a[target="_blank"], form[target="_blank"]')) n.removeAttribute('target');
                                n.querySelectorAll && n.querySelectorAll('a[target="_blank"], form[target="_blank"]').forEach(function (el) { try { el.removeAttribute('target'); } catch (e) { } });
                            }
                        } catch (e) { }
                    });
                });
            } catch (e) { }
        });
        mo.observe(document.documentElement || document.body, { childList: true, subtree: true });

        try {
            var origOpen = window.open;
            window.open = function (url) {
                try {
                    if (!url) return origOpen.apply(this, arguments);
                    window.location.href = url;
                    return window;
                } catch (e) {
                    return origOpen.apply(this, arguments);
                }
            };
        } catch (e) { }
    } catch (e) { }
})();
