'use strict';

$(document).ready(() => {
    // Set heights of divs to ensure proper scrolling behavior
    let resize_col = () => {
        if ($('body').width() >= 768) {
            $('.page-col').innerHeight($(window).height() - $('nav').outerHeight() - 1);
        }
    };
    resize_col();
    $(window).on('resize', resize_col);
});
