"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResponsiveContainer = ResponsiveContainer;
exports.ResponsiveGrid = ResponsiveGrid;
exports.ResponsiveStack = ResponsiveStack;
exports.ResponsiveToolbar = ResponsiveToolbar;
exports.ResponsiveText = ResponsiveText;
exports.ResponsiveMedia = ResponsiveMedia;
const react_1 = require("react");
function ResponsiveContainer({ children, className = '', as: Component = 'div', id }) {
    return (<Component id={id} className={`pop-container-responsive ${className}`}>
      {children}
    </Component>);
}
function ResponsiveGrid({ children, cols = 'auto', gap = 'md', className = '', id }) {
    const gapClass = gap === 'sm' ? 'gap-3 sm:gap-4' : gap === 'lg' ? 'gap-6 sm:gap-8' : 'gap-4 sm:gap-6';
    let gridClass = 'pop-grid-auto';
    if (cols === 2)
        gridClass = 'pop-grid-2col';
    else if (cols === 4)
        gridClass = 'pop-grid-4col';
    else if (cols === 1)
        gridClass = 'grid grid-cols-1 w-full min-w-0';
    return (<div id={id} className={`${gridClass} ${gapClass} ${className}`}>
      {children}
    </div>);
}
function ResponsiveStack({ children, direction = 'responsive', align = 'stretch', justify = 'between', gap = 'md', className = '', id }) {
    const dirClass = direction === 'vertical' ? 'flex-col' : 'flex-col sm:flex-row';
    const alignClass = align === 'start' ? 'items-start' : align === 'center' ? 'items-center' : align === 'end' ? 'items-end' : 'items-stretch';
    const justifyClass = justify === 'start' ? 'justify-start' : justify === 'center' ? 'justify-center' : justify === 'end' ? 'justify-end' : 'justify-between';
    const gapClass = gap === 'sm' ? 'gap-2 sm:gap-3' : gap === 'lg' ? 'gap-5 sm:gap-6' : 'gap-3 sm:gap-4';
    return (<div id={id} className={`flex ${dirClass} ${alignClass} ${justifyClass} ${gapClass} w-full min-w-0 ${className}`}>
      {children}
    </div>);
}
function ResponsiveToolbar({ children, className = '', id }) {
    return (<div id={id} className={`pop-toolbar-responsive ${className}`}>
      {children}
    </div>);
}
function ResponsiveText({ children, className = '', as: Component = 'p', id }) {
    return (<Component id={id} className={`pop-text-safe ${className}`}>
      {children}
    </Component>);
}
function ResponsiveMedia({ src, alt, className = '', aspectRatio = 'auto' }) {
    const aspectClass = aspectRatio === 'video' ? 'aspect-video' : aspectRatio === 'square' ? 'aspect-square' : aspectRatio === 'wide' ? 'aspect-[21/9]' : '';
    return (<img src={src} alt={alt} loading="lazy" className={`pop-media-responsive rounded-xl ${aspectClass} ${className}`}/>);
}
//# sourceMappingURL=ResponsiveFoundation.js.map