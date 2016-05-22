
import { Promise } from 'es6-promise-min';
import postRobot from 'post-robot';
import { urlEncode, popup, noop, extend, pop, getElement } from '../util';
import { CONSTANTS, CONTEXT_TYPES } from '../constants';
import { PopupOpenError } from '../error';

let activeComponents = [];

export class ParentComponent {

    constructor(component, options) {
        this.component = component;

        this.validate(options);

        if (component.singleton && activeComponents.some(comp => comp.component === component)) {
            throw new Error(`${component.tag} is a singleton, and an only be instantiated once`);
        }

        activeComponents.push(this);

        this.listeners = [];

        this.setProps(options.props);

        this.onEnter = options.onEnter || noop;
        this.onExit = options.onExit   || noop;
        this.onClose = options.onClose || noop;
        this.onError = options.onError || noop;
        this.onTimeout = options.onTimeout || options.onError || noop;

        this.timeout = options.timeout;
    }

    setProps(props) {
        this.validateProps(props);
        this.props = props;
        this.normalizedProps = this.normalizeProps(this.props);
        this.queryString = this.propsToQuery(this.normalizedProps);
        this.url = `${this.component.url}?${this.queryString}`;
    }

    updateProps(props) {
        return Promise.resolve().then(function() {

            let oldNormalizedProps = JSON.stringify(this.normalizedProps);

            let newProps = {};
            extend(newProps, this.props);
            extend(newProps, props);

            this.setProps(newProps);

            if (this.window && oldNormalizedProps !== JSON.stringify(this.normalizedProps)) {
                return postRobot.send(this.window, CONSTANTS.POST_MESSAGE.PROPS, {
                    props: this.normalizedProps
                });
            }
        });
    }

    validate(options) {

        if (options.timeout && !(typeof options.timeout === 'number')) {
            throw new Error(`Expected options.timeout to be a number: ${options.timeout}`);
        }

        if (options.container && !this.component.context.iframe) {
            throw new Error(`Can not render to a container: does not support iframe mode`);
        }
    }

    validateProps(props) {

        for (let key of Object.keys(this.component.props)) {
            let prop = this.component.props[key]

            if (prop.required !== false && (!props.hasOwnProperty(key) || props[key] === null || props[key] === undefined || props[key] === '')) {
                throw new Error(`Prop is required: ${key}`);
            }

            let value = props[key];

            if (prop.type === 'function') {

                if (!(value instanceof Function)) {
                    throw new Error(`Prop is not of type string: ${key}`);
                }

            } else if (prop.type === 'string') {

                if (value === null || value === undefined) {
                    value = '';
                }

                if (typeof value !== 'string') {
                    throw new Error(`Prop is not of type string: ${key}`);
                }

            } else if (prop.type === 'object') {

                try {
                    JSON.stringify(value);
                } catch (err) {
                    throw new Error(`Unable to serialize prop: ${key}`);
                }

            } else if (prop.type === 'number') {

                if (isNaN(parseInt(value, 10))) {
                    throw new Error(`Prop is not a number: ${key}`);
                }
            }
        }
    }

    normalizeProps(props) {

        props = props || {};
        let result = {};

        for (let key of Object.keys(this.component.props)) {

            let prop = this.component.props[key]
            let value = props[key];

            if (prop.type === 'boolean') {
                result[key] = Boolean(value);

            } else if (prop.type === 'function') {
                continue;

            } else if (prop.type === 'string') {
                result[key] = value || '';

            } else if (prop.type === 'object') {
                result[key] = JSON.stringify(value);

            } else if (prop.type === 'number') {
                result[key] = parseInt(value || 0, 10);
            }
        }

        return result;
    }

    propsToQuery(props) {

        return Object.keys(props).map(key => {

            let value = props[key];

            if (!value) {
                return '';
            }

            let result;

            if (typeof value === 'boolean') {
                result = '1';
            } else if (typeof value === 'string') {
                result = value;
            } else if (typeof value === 'object') {
                result = JSON.stringify(value);
            }

            return `${urlEncode(key)}=${urlEncode(result)}`;

        }).filter(Boolean).join('&');
    }

    getPosition() {

        let pos = {};
        let dimensions = this.component.dimensions;

        if (typeof dimensions.x === 'number') {
            pos.x = dimensions.x;
        } else {
            let width = window.innerWidth;

            if (width <= dimensions.width) {
                pos.x = 0;
            } else {
                pos.x = Math.floor((width / 2) - (dimensions.width / 2));
            }
        }

        if (typeof dimensions.y === 'number') {
            pos.y = dimensions.y;
        } else {

            let height = window.innerHeight;

            if (height <= dimensions.height) {
                pos.y = 0;
            } else {
                pos.y = Math.floor((height / 2) - (dimensions.height / 2));
            }
        }

        return pos;
    }

    render(el) {

        if (el && this.component.contexts[CONTEXT_TYPES.IFRAME]) {
            return this.renderIframe(el);
        }

        if (this.component.defaultContext) {

            if (this.component.defaultContext === CONTEXT_TYPES.LIGHTBOX) {
                return this.renderLightbox();
            }

            if (this.component.defaultContext === CONTEXT_TYPES.POPUP) {
                try {
                    return this.renderPopup();
                } catch (err) {
                    if (!(err instanceof PopupOpenError)) {
                        throw err;
                    }
                }
            }
        }

        if (this.component.contexts[CONTEXT_TYPES.LIGHTBOX]) {
            return this.renderLightbox();

        }

        if (this.component.contexts[CONTEXT_TYPES.POPUP]) {
            return this.renderPopup();
        }

        if (this.component.contexts[CONTEXT_TYPES.IFRAME]) {
            throw new Error(`Can not render to iframe without a container element`);
        }

        throw new Error(`No context options available for render`);
    }

    renderLightbox() {

        this.renderIframe(document.body);

        let pos = this.getPosition();
        this.iframe.setAttribute('style', `position: absolute; top: ${pos.y}; left ${pos.x};`);

        return this;
    }

    renderIframe(element) {

        this.openIframe(element);
        this.loadUrl(this.url);

        return this;
    }

    openIframe(element) {

        element = getElement(element);

        this.iframe = document.createElement('iframe');

        this.iframe.width = this.component.dimensions.width;
        this.iframe.height = this.component.dimensions.height;

        element.appendChild(this.iframe);

        this.context = CONSTANTS.CONTEXT.IFRAME;
        this.window = this.iframe.contentWindow;
        this.listen();

        return this;
    }

    renderPopup() {

        this.openPopup();
        this.loadUrl(this.url);

        return this;
    }

    openPopup() {

        let pos = this.getPosition();

        this.popup = popup('about:blank', {
            width: this.component.dimensions.width,
            height: this.component.dimensions.height,
            top: pos.y,
            left: pos.x
        });

        if (!this.popup || this.popup.closed || typeof this.popup.closed === 'undefined') {
             throw new PopupOpenError(`Can not open popup window - blocked`);
        }

        this.context = CONSTANTS.CONTEXT.POPUP;
        this.window = this.popup;
        this.listen();

        return this;
    }

    loadUrl(url) {

        if (this.popup) {
            this.popup.location = url;
        } else if (this.iframe) {
            this.iframe.src = url;
        }
    }

    listen(win) {

        let childListeners = this.childListeners();

        for (let listenerName of Object.keys(childListeners)) {
            this.addListener(postRobot.on(listenerName, { window: this.window }, data => {
                return childListeners[listenerName].call(this, data);
            }));
        }

        if (this.timeout) {
            setTimeout(() => {
                if (!this.entered) {
                    this.destroy(new Error(`Loading component ${this.component.tag} at ${this.url} timed out after ${this.timeout} milliseconds`));
                }
            }, this.timeout);
        }
    }

    childListeners() {
        return {
            [ CONSTANTS.POST_MESSAGE.INIT ]: function(data) {
                this.onEnter.call(this);
                this.entered = true;

                return {
                    context: this.context,
                    props: this.normalizedProps
                };
            },

            [ CONSTANTS.POST_MESSAGE.CLOSE ]: function(data) {
                this.cleanup();
            },

            [ CONSTANTS.POST_MESSAGE.FOCUS ]: function(data) {
                this.focus();
            },

            [ CONSTANTS.POST_MESSAGE.RESIZE ]: function(data) {

                if (this.context === CONSTANTS.CONTEXT.POPUP) {
                    throw new Error('Can not resize popup from parent');
                }

                return this.resize(data.width, data.height);
            },

            [ CONSTANTS.POST_MESSAGE.REDIRECT ]: function(data) {
                this.cleanup();
                window.location = data.url;
            },

            [ CONSTANTS.POST_MESSAGE.PROP_CALLBACK ]: function(data) {
                return this.props[data.key].apply(null, data.args);
            }
       }
    }

    addListener(listener) {
        this.listeners.push(listener);
        return listener;
    }

    close() {
        return postRobot.send(this.window, CONSTANTS.POST_MESSAGE.CLOSE).then(data => {
            this.cleanup();
        }).catch(err => {
            console.warn('Error sending close message to child', err.stack || err.toString());
            this.cleanup();
        });
    }

    focus() {
        if (this.popup) {
            this.popup.focus();
        }
        return this;
    }

    resize(height, width) {
        return Promise.resolve().then(() => {

            if (this.context === CONSTANTS.CONTEXT.POPUP) {
                return postRobot.send(this.popup, CONSTANTS.POST_MESSAGE.RESIZE, {
                    height: height,
                    width: width
                });

            } else if (this.context === CONSTANTS.CONTEXT.IFRAME) {

                this.iframe.height = height;
                this.iframe.width = width;
            }
        });
    }

    destroy(err) {
        this.cleanup();
        this.onTimeout.call(this, err);
        return this;
    }

    cleanup() {

        if (this.popup) {
            this.popup.close();
        } else if (this.iframe) {
            this.iframe.parentNode.removeChild(this.iframe);
        }

        for (let listener of this.listeners) {
            listener.cancel();
        }
    }

}

export const internalProps = {

    onEnter: {
        type: 'function',
        required: false
    },

    onExit: {
        type: 'function',
        required: false
    },

    onClose: {
        type: 'function',
        required: false
    },

    onError: {
        type: 'function',
        required: false
    },

    timeout: {
        type: 'number',
        required: false
    }
}

ParentComponent.fromProps = function fromProps(component, props) {

    return new ParentComponent(component, {

        props,

        onEnter: pop(props, 'onEnter'),
        onExit:  pop(props, 'onExit'),
        onClose: pop(props, 'onClose'),
        onError: pop(props, 'onError'),

        timeout: parseInt(pop(props, 'timeout', 0), 10)
    });
}