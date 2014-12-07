/**
 * jQuery Ripples plugin v0.1.0 / http://github.com/sirxemic/jquery.ripples
 * MIT License
 * @author sirxemic / http://sirxemic.com/
 */

+function ($) {

    var gl;
    var $window = $(window); // There is only one window, so why not cache the jQuery-wrapped window?

    String.prototype.endsWith = function (suffix) {
        return this.indexOf(suffix, this.length - suffix.length) !== -1;
    }; // Stupid Chrome

    function hasWebGLSupport() {
        var canvas = document.createElement('canvas');
        var context = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        var result = context && context.getExtension('OES_texture_float') && context.getExtension('OES_texture_float_linear');
        console.log(context.getExtension('OES_texture_float'));
        return true;
        return result;
    }

    var supportsWebGL = hasWebGLSupport();

    function createProgram(vertexSource, fragmentSource, uniformValues) {
        function compileSource(type, source) {
            var shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                throw new Error('compile error: ' + gl.getShaderInfoLog(shader));
            }
            return shader;
        }

        var program = {};

        program.id = gl.createProgram();
        gl.attachShader(program.id, compileSource(gl.VERTEX_SHADER, vertexSource));
        gl.attachShader(program.id, compileSource(gl.FRAGMENT_SHADER, fragmentSource));
        gl.linkProgram(program.id);
        if (!gl.getProgramParameter(program.id, gl.LINK_STATUS)) {
            throw new Error('link error: ' + gl.getProgramInfoLog(program.id));
        }

        // Fetch the uniform and attribute locations
        program.uniforms = {};
        program.locations = {};
        gl.useProgram(program.id);
        gl.enableVertexAttribArray(0);

        var name, type, regex = /uniform (\w+) (\w+)/g, shaderCode = vertexSource + fragmentSource;
        while ((match = regex.exec(shaderCode)) != null) {
            name = match[2];
            program.locations[name] = gl.getUniformLocation(program.id, name);
        }

        return program;
    }

    function bindTexture(texture, unit) {
        gl.activeTexture(gl.TEXTURE0 + (unit || 0));
        gl.bindTexture(gl.TEXTURE_2D, texture);
    }

    // Extend the css
    $('head').prepend('<style>.jquery-ripples { position: relative; z-index: 0; }</style>');

    // RIPPLES CLASS DEFINITION
    // =========================

    var Ripples = function (el, options) {
        var that = this;

        this.$el = $(el);
        this.$el.addClass('jquery-ripples');

        // If this element doesn't have a background image, don't apply this effect to it
        var backgroundUrl = (/url\(["']?([^"']*)["']?\)/.exec(this.$el.css('background-image')));
        if (backgroundUrl == null) return;
        backgroundUrl = backgroundUrl[1];

        this.resolution = options.resolution || 256;
        this.textureDelta = new Float32Array([1 / this.resolution, 1 / this.resolution]);

        var canvas = document.createElement('canvas');
        canvas.width = this.$el.innerWidth();
        canvas.height = this.$el.innerHeight();
        this.canvas = canvas;
        this.$canvas = $(canvas);
        this.$canvas.css({
            position: 'absolute',
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            zIndex: -1
        });
        this.parameters = { startTime: Date.now(), time: 0, mouseX: 0.5, mouseY: 0.5, screenWidth: 0, screenHeight: 0 };
        this.clientXLast = 0, this.clientYLast = 0;

        this.$el.append(canvas);
        this.context = gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

        // Load extensions
        gl.getExtension('OES_texture_float');
        gl.getExtension('OES_texture_float_linear');
        gl.getExtension('OES_standard_derivatives');

        // Init events
        $(window).on('resize', function () {
            if (that.$el.innerWidth() != that.canvas.width || that.$el.innerHeight() != that.canvas.height) {
                canvas.width = that.$el.innerWidth();
                canvas.height = that.$el.innerHeight();
            }
            //that.parameters.screenWidth = canvas.width;
            //that.parameters.screenHeight = canvas.height;
            that.parameters.screenWidth = 512;
            that.parameters.screenHeight = 512;
        });

        $(window).on('mousemove', function ( event ) {
            var clientX = event.clientX;
            var clientY = event.clientY;

            if (that.clientXLast == clientX && that.clientYLast == clientY)
                return;

            that.clientXLast = clientX;
            that.clientYLast = clientY;

            that.parameters.mouseX = clientX / window.innerWidth;
            that.parameters.mouseY = 1 - clientY / window.innerHeight;
        });

        $(window).resize();

        this.textures = [];
        this.framebuffers = [];

        for (var i = 0; i < 2; i++) {
            var texture = gl.createTexture();
            var framebuffer = gl.createFramebuffer();

            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            framebuffer.width = this.resolution;
            framebuffer.height = this.resolution;

            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.resolution, this.resolution, 0, gl.RGBA, gl.FLOAT, null);

            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) != gl.FRAMEBUFFER_COMPLETE) {
                throw new Error('Rendering to this texture is not supported (incomplete framebuffer)');
            }

            gl.bindTexture(gl.TEXTURE_2D, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);

            this.textures.push(texture);
            this.framebuffers.push(framebuffer);
        }

        // Init GL stuff
        this.quad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,
            +1, -1,
            +1, +1,
            -1, +1
        ]), gl.STATIC_DRAW);

        this.initShaders();

        // Init textures
        var image = new Image;
        image.crossOrigin = '';
        image.onload = function () {
            gl = that.context;

            function isPowerOfTwo(x) {
                return (x & (x - 1)) == 0;
            }

            var wrapping = (isPowerOfTwo(image.width) && isPowerOfTwo(image.height)) ? gl.REPEAT : gl.CLAMP_TO_EDGE;

            that.backgroundWidth = image.width;
            that.backgroundHeight = image.height;

            var texture = gl.createTexture();

            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapping);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapping);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

            that.backgroundTexture = texture;

            // Everything loaded successfully - hide the CSS background image
            that.$el.css('backgroundImage', 'none');
        };
        image.src = backgroundUrl;

        this.visible = true;

        // Init animation
        function step() {
            that.update();
            requestAnimationFrame(step);
        }

        requestAnimationFrame(step);
    };

    Ripples.DEFAULTS = {
        resolution: 256
    };

    Ripples.prototype = {

        update: function () {
            gl = this.context;

            if (!this.visible || !this.backgroundTexture) return;

            this.updateTextures();
            this.render();
        },

        drawQuad: function () {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
        },

        render: function () {
            this.parameters.time = Date.now() - this.parameters.startTime;

            gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

            gl.useProgram(this.renderProgram.id);

            bindTexture(this.backgroundTexture, 0);
            bindTexture(this.textures[0], 1);

            gl.uniform2fv(this.renderProgram.locations.topLeft, this.renderProgram.uniforms.topLeft);
            gl.uniform2fv(this.renderProgram.locations.bottomRight, this.renderProgram.uniforms.bottomRight);

            gl.uniform1f( this.renderProgram.locations.time, this.parameters.time / 1000 );
            gl.uniform2f( this.renderProgram.locations.mouse, this.parameters.mouseX, this.parameters.mouseY );
            gl.uniform2f( this.renderProgram.locations.resolution, this.parameters.screenWidth, this.parameters.screenHeight );

            //gl.uniform1i(this.renderProgram.locations.iChannel0, 0);
            //gl.uniform1i(this.renderProgram.locations.iChannel1, 1);

            this.drawQuad();
        },

        updateTextures: function() {
            this.computeTextureBoundaries();

            gl.viewport(0, 0, this.resolution, this.resolution);

            for (var i = 0; i < 2; i++) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[i]);
                bindTexture(this.textures[1-i]);
                gl.useProgram(this.updateProgram[i].id);

                this.drawQuad();
            }

            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        },

        computeTextureBoundaries: function () {
            var backgroundSize = this.$el.css('background-size');
            var backgroundAttachment = this.$el.css('background-attachment');
            var backgroundPosition = this.$el.css('background-position').split(' ');

            // Here the 'window' is the element which the background adapts to
            // (either the chrome window or some element, depending on attachment)
            var parElement = backgroundAttachment == 'fixed' ? $window : this.$el;
            var winOffset = parElement.offset() || {left: pageXOffset, top: pageYOffset};
            var winWidth = parElement.innerWidth();
            var winHeight = parElement.innerHeight();

            // TODO: background-clip
            if (backgroundSize == 'cover') {
                var scale = Math.max(winWidth / this.backgroundWidth, winHeight / this.backgroundHeight);

                var backgroundWidth = this.backgroundWidth * scale;
                var backgroundHeight = this.backgroundHeight * scale;
            }
            else if (backgroundSize == 'contain') {
                var scale = Math.min(winWidth / this.backgroundWidth, winHeight / this.backgroundHeight);

                var backgroundWidth = this.backgroundWidth * scale;
                var backgroundHeight = this.backgroundHeight * scale;
            }
            else {
                backgroundSize = backgroundSize.split(' ');
                var backgroundWidth = backgroundSize[0];
                var backgroundHeight = backgroundSize[1] || backgroundSize[0];

                if (backgroundWidth.endsWith('%')) backgroundWidth = winWidth * parseFloat(backgroundWidth) / 100;
                else if (backgroundWidth != 'auto') backgroundWidth = parseFloat(backgroundWidth);

                if (backgroundHeight.endsWith('%')) backgroundHeight = winHeight * parseFloat(backgroundHeight) / 100;
                else if (backgroundHeight != 'auto') backgroundHeight = parseFloat(backgroundHeight);

                if (backgroundWidth == 'auto' && backgroundHeight == 'auto') {
                    backgroundWidth = this.backgroundWidth;
                    backgroundHeight = this.backgroundHeight;
                }
                else {
                    if (backgroundWidth == 'auto') backgroundWidth = this.backgroundWidth * (backgroundHeight / this.backgroundHeight);
                    if (backgroundHeight == 'auto') backgroundHeight = this.backgroundHeight * (backgroundWidth / this.backgroundWidth);
                }
            }

            // Compute backgroundX and backgroundY in page coordinates
            var backgroundX = backgroundPosition[0];
            var backgroundY = backgroundPosition[1];

            if (backgroundX == 'left') backgroundX = winOffset.left;
            else if (backgroundX == 'center') backgroundX = winOffset.left + winWidth / 2 - backgroundWidth / 2;
            else if (backgroundX == 'right') backgroundX = winOffset.left + winWidth - backgroundWidth;
            else if (backgroundX.endsWith('%')) {
                backgroundX = winOffset.left + (winWidth - backgroundWidth) * parseFloat(backgroundX) / 100;
            }
            else {
                backgroundX = parseFloat(backgroundX);
            }

            if (backgroundY == 'top') backgroundY = winOffset.top;
            else if (backgroundY == 'center') backgroundY = winOffset.top + winHeight / 2 - backgroundHeight / 2;
            else if (backgroundY == 'bottom') backgroundY = winOffset.top + winHeight - backgroundHeight;
            else if (backgroundY.endsWith('%')) {
                backgroundY = winOffset.top + (winHeight - backgroundHeight) * parseFloat(backgroundY) / 100;
            }
            else {
                backgroundY = parseFloat(backgroundY);
            }

            var elementOffset = this.$el.offset();

            this.renderProgram.uniforms.topLeft = new Float32Array([
                (elementOffset.left - backgroundX) / backgroundWidth,
                (elementOffset.top - backgroundY) / backgroundHeight
            ]);
            this.renderProgram.uniforms.bottomRight = new Float32Array([
                this.renderProgram.uniforms.topLeft[0] + this.$el.innerWidth() / backgroundWidth,
                this.renderProgram.uniforms.topLeft[1] + this.$el.innerHeight() / backgroundHeight
            ]);

            var maxSide = Math.max(this.canvas.width, this.canvas.height);

        },

        initShaders: function () {
            var vertexShader = [
                'attribute vec2 vertex;',
                'varying vec2 coord;',
                'varying vec2 surfacePosition;',
                'void main() {',
                'coord = vertex * 0.5 + 0.5;',
                'surfacePosition = vertex;',
                'gl_Position = vec4(surfacePosition, 0.0, 1.0);',
                '}'
            ].join('\n');
            this.updateProgram = [0,0];
            this.updateProgram[0] = createProgram(vertexShader, [
                'precision highp float;',

                'uniform sampler2D texture;',
                'uniform vec2 delta;',

                'varying vec2 coord;',

                'void main() {',
                'vec4 info = texture2D(texture, coord);',

                'vec2 dx = vec2(delta.x, 0.0);',
                'vec2 dy = vec2(0.0, delta.y);',

                'float average = (',
                'texture2D(texture, coord - dx).r +',
                'texture2D(texture, coord - dy).r +',
                'texture2D(texture, coord + dx).r +',
                'texture2D(texture, coord + dy).r',
                ') * 0.25;',

                'info.g += (average - info.r) * 2.0;',
                'info.g *= 0.995;',
                'info.r += info.g;',

                'gl_FragColor = info;',
                '}'
            ].join('\n'));
            gl.uniform2fv(this.updateProgram[0].locations.delta, this.textureDelta);

            this.updateProgram[1] = createProgram(vertexShader, [
                'precision highp float;',

                'uniform sampler2D texture;',
                'uniform vec2 delta;',

                'varying vec2 coord;',

                'void main() {',
                'vec4 info = texture2D(texture, coord);',

                'vec3 dx = vec3(delta.x, texture2D(texture, vec2(coord.x + delta.x, coord.y)).r - info.r, 0.0);',
                'vec3 dy = vec3(0.0, texture2D(texture, vec2(coord.x, coord.y + delta.y)).r - info.r, delta.y);',
                'info.ba = normalize(cross(dy, dx)).xz;',

                'gl_FragColor = info;',
                '}'
            ].join('\n'));
            gl.uniform2fv(this.updateProgram[1].locations.delta, this.textureDelta);


            this.renderProgram = createProgram(vertexShader, [
                'precision highp float;',
                'varying vec2 coord;',
                'uniform vec2 topLeft;',
                'uniform vec2 bottomRight;',
                'uniform float time;',
                'uniform vec2  mouse;',
                'uniform vec2  resolution;',
                'varying vec2 surfacePosition;',

                'uniform sampler2D iChannel0;',
                'uniform sampler2D iChannel1;',
                //

/*
                'void main(void){',
                '    float a = gl_FragCoord.x / 512.0;',
                'gl_FragColor = vec4(vec3(a), 1.0);',
                '}'
/**/
                /* // http://glslsandbox.com/e#21631.1 */
                'vec3 getColor(float phase);',
                'float PI = 4.*atan(1.);',
                'void main(void) {',
                'float x = distance(surfacePosition, vec2(0.0,0.0));',
                'float z = distance(surfacePosition, vec2(0.1,-0.3));',
                'float y = 1.0 - distance(surfacePosition, vec2(0.0,0.0));',
                'x = mod(x*3.1 + tan(time), 0.2 + step(time,0.3));',
                'z = mod(z*3.1 + tan(cos(time*3.)), 0.4 + step(time*2.0,0.9));',
                'gl_FragColor = vec4(z,x * 1.9,0.3,0.4) + vec4(z,y * 1.9,0.3,0.4);',
                '}',
                /**/
                /*
                'vec2 pattern(vec2 p) {',
                '	',
                '	float a = atan(p.x,p.y);',
                '	float r = length(p);',
                '	',
                '	return vec2(sin(a*3.), sin(r*5.));',
                '}',
                '',
                'void main( void ) {',
                '',
                '	vec2 p = surfacePosition * 1.0;',
                '	vec3 col = vec3(0.0);',
                '	',
                '	for (int i=0; i<3; i++)',
                '		p.xy = pattern(p);',
                '	',
                '	col.xy = p.xy;',
                '	',
                '	gl_FragColor = vec4( col, 1.0 );',
                '',
                '}',
                /**/
                ''
            ].join('\n'));

        },

        // Actions
        destroy: function () {
            this.canvas.remove();
            this.$el.off('.ripples');
            this.$el.css('backgroundImage', '');
            this.$el.removeClass('jquery-ripples').data('ripples', undefined);
        },

        show: function () {
            this.$canvas.show();
            this.$el.css('backgroundImage', 'none');
            this.visible = true;
        },

        hide: function () {
            this.$canvas.hide();
            this.$el.css('backgroundImage', '');
            this.visible = false;
        }
    };

    // RIPPLES PLUGIN DEFINITION
    // ==========================

    var old = $.fn.ripples;

    $.fn.ripples = function (option) {
        console.log(supportsWebGL);
        if (!supportsWebGL) throw new Error('Your browser does not support at least one of the following: WebGL, OES_texture_float extension, OES_texture_float_linear extension.');

        var args = (arguments.length > 1) ? Array.prototype.slice.call(arguments, 1) : undefined;

        return this.each(function () {
            var $this = $(this);
            var data = $this.data('ripples');
            var options = $.extend({}, Ripples.DEFAULTS, $this.data(), typeof option == 'object' && option);
            if (!data && typeof option == 'string' && option == 'destroy') return;
            if (!data) $this.data('ripples', (data = new Ripples(this, options)));
            else if (typeof option == 'string') Ripples.prototype[option].apply(data, args);
        });
    }

    $.fn.ripples.Constructor = Ripples;


    // RIPPLES NO CONFLICT
    // ====================

    $.fn.ripples.noConflict = function () {
        $.fn.ripples = old;
        return this;
    }

}(window.jQuery);
