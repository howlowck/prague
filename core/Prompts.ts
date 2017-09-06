import { Observableable, toFilteredObservable, RouterOrHandler, Router, Match, nullRouter, ifMatch, toRouter, first } from './Router';

// placeholders

interface BotContext extends Match {
    [name: string]: any;

    state: {
        conversation: {
            [name: string]: any;
            activePrompt: ActivePrompt;
        }
    }

    request: {
        type: string;
        text: string;
    }
    
    say: (prompt: any) => void;

    prompt: <ARGS extends object, PARAMS extends PromptParams<ARGS>, PROMPT extends Prompt<ARGS, PARAMS>> (prompt: PROMPT) => void;
    cancelPrompt: () => void
}

function ifMessage<CONTEXT extends BotContext>(routerOrHandler: RouterOrHandler<CONTEXT>) {
    return ifMatch(context => context.request.type === 'message', routerOrHandler);
}

function ifRegEx<CONTEXT extends BotContext>(regex: RegExp, routerOrHandler: RouterOrHandler<CONTEXT>) {
    return nullRouter;
}

// end placeholders

interface ActivePrompt {
    name: string;
    params: any;
}

// inside prompt routers, context gets a field called "thisPrompt"
interface PromptContext <
    ARGS extends object,
    PARAMS extends PromptParams<ARGS>,
    PROMPT extends Prompt<ARGS, PARAMS>
> extends BotContext {
    thisPrompt: PROMPT;
}

// Prompts is all statics - it contains the prompt registry, the active prompt, and some helper methods
class Prompts {
    private static prompts: {
        [name: string]: Prompt;
    } = {}

    static add(
        name: string,
        prompt: Prompt
    ) {
        this.prompts[name] = prompt;
    }

    // Here's the method called by context.prompt()
    static invokePrompt (
        context: BotContext,
        prompt: Prompt
    ) {
        prompt._say(context);
        context.state.conversation.activePrompt = {
            name: prompt._name,
            params: prompt.params
        }
    }

    // Here's the method called by context.cancelPrompt()
    static cancelPrompt() {
        context.state.conversation.activePrompt = undefined;
    }

    // if there's an active prompt, route to it
    static routeTo<CONTEXT extends BotContext>(): Router<CONTEXT> {
        return ifMessage({
            getRoute: (context) => toFilteredObservable(context.state.conversation.activePrompt)
                .flatMap(({ name, params }) => toFilteredObservable(Prompts.prompts[name])
                    .do(_ => context.cancelPrompt())
                    .flatMap(prompt => prompt._getRouter(params).getRoute(context))
                )
        } as Router<CONTEXT>);
    }

    static retry<CONTEXT extends BotContext>(routerOrHandler: RouterOrHandler<CONTEXT>) {
        return ifMatch(context => context.thisPrompt.params.retries > 0, routerOrHandler);
    }
}

interface PromptParams<ARGS extends object> {
    say?: string;
    retries?: number;
    with?: ARGS;
}

class Prompt <
    ARGS extends object = any,
    PARAMS extends PromptParams<ARGS> = PromptParams<ARGS>
> {
    constructor(
        name: string,
        router: RouterOrHandler<PromptContext<ARGS, PARAMS, Prompt<ARGS, PARAMS>>>
    ) {
        Prompts.add(name, this);  
        this._name = name;
        this._router = toRouter(router);
    }

    _name: string;
    _router: Router<PromptContext<ARGS, PARAMS, Prompt<ARGS, PARAMS>>>;

    _say(context: BotContext) {
        if (this.params.say)
            context.say(this.params.say);
    }

    _getRouter(params: PARAMS): Router<BotContext> {
        return {
            getRoute: (context) => this._router.getRoute({
                ... context,
                thisPrompt: this._cloneWithParams(params)
            })
        }
    }

    private _cloneWithParams (params: PARAMS): this {
        return Object.assign(Object.create(Object.getPrototypeOf(this)), this, { params })
    }

    protected _cloneWithParam <T> (name: string, value: T): this {
        return this._cloneWithParams({
            ... this.params as any, 
            [name]: value
        } as PARAMS);
    }

    params: PARAMS = {} as any;

    say(prompt: string) {
        return this._cloneWithParam('say', prompt);
    }

    retries(triesLeft: number) {
        return this._cloneWithParam('retries', triesLeft);
    }

    retry() {
        return this.params.retries > 0
            ? this._cloneWithParam('retries', this.params.retries - 1)
            : this;
    }

    with(args: ARGS) {
        return this._cloneWithParam('with', args);
    }
}

// inside prompt error routers, context gets a field called "error"
interface IErrorContext {
    error: string;
}

interface Parser<CONTEXT extends BotContext> {
    (context: CONTEXT): CONTEXT | string;
}

function parse<CONTEXT extends BotContext>(
    parser: Parser<CONTEXT>,
    parsedRouterOrHandler: RouterOrHandler<CONTEXT>,
    errorRouterOrHandler?: RouterOrHandler<CONTEXT & IErrorContext>
): Router<CONTEXT> {
    const parsedRouter = toRouter(parsedRouterOrHandler);
    const errorRouter = errorRouterOrHandler ? toRouter(errorRouterOrHandler): nullRouter;

    return {
        getRoute: (context) => {
            const parseResult = parser(context);
            return typeof parseResult === 'string'
                ? errorRouter
                    .getRoute({
                        ... context as any,
                        error: parseResult
                    })
                : parsedRouter
                    .getRoute(parseResult);
        }
    }
}

function parseText<CONTEXT extends BotContext>(context: CONTEXT) {
    if (context.request.text.length === 0)
        return "Empty String";

    return {
        ... context as any,
        // put text into entities
    }
}

class TextPrompt<ARGS extends object = any> extends Prompt<ARGS> {
    constructor(
        name: string,
        promptRouterOrHandler: RouterOrHandler<PromptContext<ARGS, PromptParams<ARGS>, TextPrompt<ARGS>>>,
        errorRouterOrHandler?: RouterOrHandler<PromptContext<ARGS, PromptParams<ARGS>, TextPrompt<ARGS>> & IErrorContext>
    ) {
        super(name, parse(parseText, promptRouterOrHandler, errorRouterOrHandler));
    }
}

const choicesToSuggestedActions = (choices: string[]) => {};

interface ChoicePromptParams<ARGS extends object = any> extends PromptParams<ARGS> {
    choices: string[]; // replace with more sophisticated type
}

function parseChoices<CONTEXT extends BotContext>(context: CONTEXT, choices: string[]) {
    if (context.request.text.length === 0)
        return "Empty String";

    const choice = choices.find(choice => choice === context.request.text);
    if (!choice)
        return "Not one of the listed choices";

    return {
        ... context as any,
        // put choice into entities
    }
}

class ChoicePrompt<ARGS extends object = any> extends Prompt<ARGS, ChoicePromptParams<ARGS>> {
    constructor(
        name: string,
        promptRouterOrHandler: RouterOrHandler<PromptContext<ARGS, PromptParams<ARGS>, TextPrompt<ARGS>>>,
        errorRouterOrHandler?: RouterOrHandler<PromptContext<ARGS, PromptParams<ARGS>, TextPrompt<ARGS>> & IErrorContext>
    ) {
        super(name, parse(
            (context: PromptContext<ARGS, PromptParams<ARGS>, TextPrompt<ARGS>>) => parseChoices(context, context.params.choices),
            promptRouterOrHandler,
            errorRouterOrHandler
        ));
    }

    _say(context: BotContext) {
        if (!this.params.choices) {
            console.warn("ChoicePrompt must have choices");
            return;
        }
        context.say({
            type: 'message',
            text: this.params.say,
            suggestedActions: choicesToSuggestedActions(this.params.choices)
        });
    }

    choices(choices: string[]) {
        return this._cloneWithParam('choices', choices);        
    }
}
