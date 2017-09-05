import { Observableable, toFilteredObservable, RouterOrHandler, Router, Match, nullRouter, ifMatch, toRouter } from './Router';

interface PromptParams<ARGS extends object> {
    say?: string;
    retries?: number;
    with?: ARGS;
}

// placeholder for full BotContext
interface BotContext extends Match {
    [name: string]: any;
    state: {
        conversation: {
            activePrompt: ActivePrompt;
        }
    }

    prompt: <ARGS extends object = any, PARAMS extends PromptParams<ARGS> = PromptParams<ARGS>> (prompt: IPrompt<ARGS, PARAMS>) => void;
    cancelPrompt: () => void
};

// inside prompt routers, context gets a field called "thisPrompt"
interface PromptContext <
    ARGS extends object = any,
    PARAMS extends PromptParams<ARGS> = PromptParams<ARGS>,
    PROMPT extends IPrompt<ARGS, PARAMS> = IPrompt<ARGS, PARAMS>
> extends BotContext {
    thisPrompt: PROMPT;
}

interface PromptInstance <ARGS extends object = any, PARAMS extends PromptParams<ARGS> = PromptParams<ARGS>> {
    say(context: BotContext): void;
    router(): Router<PromptContext<ARGS, PARAMS>>;
}

// consider stripping this down by having no assumptions about parameters at all
interface IPrompt <ARGS extends object = any, PARAMS extends PromptParams<ARGS> = PromptParams<ARGS>> {
    _name: string;
    params: PARAMS;
    _getPromptInstance(params?: PARAMS): PromptInstance<ARGS>;

    say(prompt: string): this;
    retries(triesLeft: number): this;
    with(args: ARGS): this;
}

interface ActivePrompt {
    name: string;
    params: any;
}

// Prompts is all statics - it contains the registry for prompts, the active prompt, and some helper functions
class Prompts {
    private static prompts: {
        [name: string]: IPrompt;
    } = {}

    static add(
        name: string,
        prompt: IPrompt
    ) {
        this.prompts[name] = prompt;
    }

    // Here's the function called by context.prompt() - in the real world this would be async when accessing activePrompt
    static invokePrompt <ARGS extends object = any, PARAMS extends PromptParams<ARGS> = any> (
        context: BotContext,
        prompt: IPrompt<ARGS, PARAMS>
    ) {
        prompt._getPromptInstance().say(context);
        context.state.conversation.activePrompt = {
            name: prompt._name,
            params: prompt.params
        }
    }

    // Here's the function called by context.cancelPrompt() - in the real world this would be async when accessing activePrompt
    static cancelPrompt() {
        context.state.conversation.activePrompt = undefined;
    }

    // if there's an active prompt, route to it
    static routeTo<CONTEXT extends BotContext>() : Router<CONTEXT> {
        return {
            getRoute: (context) => toFilteredObservable(context.state.conversation.activePrompt)
                .flatMap(({ name, params }) => toFilteredObservable(Prompts.prompts[name])
                    .map(prompt => prompt._getPromptInstance(params).router())
                    .do(_ => context.cancelPrompt())
                    .flatMap(router => router.getRoute({
                        ... context as any,
                        thisPrompt: prompt
                    }))
                )
        }
    }
}

abstract class BasePrompt <
    ARGS extends object = any,
    PARAMS extends PromptParams<ARGS> = PromptParams<ARGS>
> implements IPrompt<ARGS, PromptParams<ARGS>> {
    constructor(name: string) {
        Prompts.add(name, this);  
        this._name = name;  
    }

    _name: string;
    params: PARAMS = {} as any;

    abstract _getPromptInstance(params?: PARAMS): PromptInstance<ARGS>;

    protected _cloneWithParam <T> (name: string, value: T): this {
        return Object.assign(Object.create(Object.getPrototypeOf(this)), this, {
            params: {
                ... this.params as any, 
                [name]: value
            }
        });
    }

    say(prompt: string) {
        return this._cloneWithParam('say', prompt);
    }

    retries(triesLeft: number) {
        return this._cloneWithParam('retries', triesLeft);
    }

    with(args: ARGS) {
        return this._cloneWithParam('with', args);
    }
}

class Prompt <ARGS extends object = any> extends BasePrompt<ARGS, PromptParams<ARGS>> {
    private router: Router<PromptContext<ARGS, PromptParams<ARGS>, Prompt>>;

    constructor(
        protected name: string,
        routerOrHandler: RouterOrHandler<PromptContext<ARGS, PromptParams<ARGS>, Prompt>>
    ) {
        super(name);
        this.router = toRouter(routerOrHandler);
    }

    _getPromptInstance(params?: PromptParams<ARGS>): PromptInstance<ARGS> {
        return {
            say: (context) => {
                if (params.say)
                    context.say(params.say);
            },

            router: () => this.router
        }
    }
}

let context: BotContext;

const myPromptHere = new Prompt<{ foo: string }>('name', context => {
    context.say(`You did good, ${context.thisPrompt.params.with.foo}`);
    context.prompt(context.thisPrompt.say("how ya doing?").with({ foo: 5 }));
});

context.prompt(myPromptHere.say("Yo yo").retries(5));

// And now let's define some other prompts

interface MyPromptParams<ARGS extends object = any> extends PromptParams<ARGS> {
    options: any;
}

class AnotherPrompt <ARGS extends object = any> extends BasePrompt<ARGS, MyPromptParams<ARGS>> {
    private router: Router<PromptContext<ARGS>>;

    constructor(
        protected name: string,
        routerOrHandler: RouterOrHandler<PromptContext<ARGS, MyPromptParams<ARGS>, Prompt>>
    ) {
        super(name);
        this.router = toRouter(routerOrHandler);
    }

    _getPromptInstance(params?: PromptParams<ARGS>): PromptInstance<ARGS> {
        return {
            say: (context) => {
                if (params.say)
                    context.say(params.say);
            },

            router: () => this.router
        }
    }

    options(options: any) {
        return this._cloneWithParam('options', options);
    }
}

class TextPrompt<ARGS extends object = any> implements IPrompt<ARGS> {
    private ifRouter: Router<PromptContext<ARGS>>;
    private elseRouter: Router<PromptContext<ARGS>>;
    constructor(
        name: string,
        ifRouterOrHandler: RouterOrHandler<PromptContext<ARGS>>,
        elseRouterOrHandler?: RouterOrHandler<PromptContext<ARGS>>
    ) {
        this.ifRouter = toRouter(ifRouterOrHandler);
        this.elseRouter = elseRouterOrHandler ? toRouter(elseRouterOrHandler) : nullRouter;
    }

    _getPromptInstance(params?: PromptParams<ARGS>) {
        return {
            say: ()
        }
    }

    ask(prompt: string);
    retries(triesLeft: number);
}

const choicesToSuggestedActions = (choices: string[]) => {};

class ChoicePrompt<ARGS> extends Prompt<ARGS>{
    private params: ChoicePromptParams;
    constructor(name: string, routerOrHandler: routerOrHandler<PromptContext<ChoicePrompt>>);
    _getPromptInstance(params?: {
        ask: string;
        retries: number;
        choices: string[];
    }): PromptInstance<ARGS, ChoicePrompt> {
        return {
            ask: (context: BotContext) => {
                context.say({
                    type: 'text',
                    text,
                    suggestedActions: choicesToSuggestedActions(args.choices)
                }),
            
            router: 
        
        }
    }
    ask(prompt: string);
    retries(triesLeft: number);
    choices(choices: string[]);
}



// How does retries work?

// The router wants this:

const foo = new Prompt('foo', ifMatch(c => c.request.text === "I love you",
    c => c.say("I know."),
    ifMatch(c => c.thisPrompt.retries == null || c.prompt.retries > 0, c => {
        if (c.prompt.retries == null)
            c.prompt.retries = 5;
        c.say("Say it. You know you want to say it.");
        c.prompt(c.thisPrompt.retries(c.thisPrompt.params.retries - 1))
    })
));
