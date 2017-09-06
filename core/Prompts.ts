import { Observableable, toFilteredObservable, RouterOrHandler, Router, Match, nullRouter, ifMatch, toRouter, first } from './Router';

// stubs that save us from having to integrate into the full SDK during development
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

    prompt: <WITH extends object, PARAMS extends PromptParams<WITH>, PROMPT extends Prompt<WITH, PARAMS>> (prompt: PROMPT) => void;
    cancelPrompt: () => void
}

function ifMessage<CONTEXT extends BotContext>(routerOrHandler: RouterOrHandler<CONTEXT>) {
    return nullRouter as Router<CONTEXT>;
}

function ifRegEx<CONTEXT extends BotContext>(regex: RegExp, routerOrHandler: RouterOrHandler<CONTEXT>) {
    return nullRouter as Router<CONTEXT>;
}
// end stubs

interface ActivePrompt {
    name: string;
    params: any;
}

// inside prompt routers, context gets a field called "thisPrompt"
interface PromptContext <
    WITH extends object,
    PARAMS extends PromptParams<WITH>,
    PROMPT extends Prompt<WITH, PARAMS>
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
    static cancelPrompt(context: BotContext) {
        context.state.conversation.activePrompt = undefined;
    }

    // if there's an active prompt, route to it
    static routeTo<CONTEXT extends BotContext>() {
        return ifMessage(new Router<CONTEXT>(context => toFilteredObservable(context.state.conversation.activePrompt)
            .flatMap(({ name, params }) => toFilteredObservable(Prompts.prompts[name])
                .do(_ => context.cancelPrompt())
                .flatMap(prompt => prompt._getRouter(params).getRoute(context))
            )
        ));
    }

    static retry<CONTEXT extends BotContext>(routerOrHandler: RouterOrHandler<CONTEXT>) {
        return ifMatch(context => context.thisPrompt.params.retries > 0, routerOrHandler);
    }
}

interface PromptParams<WITH extends object> {
    say?: string;
    retries?: number;
    with?: WITH;
}

class Prompt <
    WITH extends object = any,
    PARAMS extends PromptParams<WITH> = PromptParams<WITH>
> {
    _getRouter: (params: PARAMS) => Router<BotContext>;

    constructor(
        name: string,
        router: RouterOrHandler<PromptContext<WITH, PARAMS, Prompt<WITH, PARAMS>>>
    ) {
        Prompts.add(name, this);  
        this._name = name;
        const _router = toRouter(router);
        this._getRouter = params => ifMatch(
            (context: BotContext) => ({
                ... context,
                thisPrompt: this._cloneWithParams(params)
            }),
            _router
        );
    }

    _name: string;
    _router: Router<PromptContext<WITH, PARAMS, Prompt<WITH, PARAMS>>>;

    _say(context: BotContext) {
        if (this.params.say)
            context.say(this.params.say);
    }

    private _cloneWithParams (params: PARAMS): this {
        return Object.assign(Object.create(Object.getPrototypeOf(this)), this, { params })
    }

    protected _cloneWithParam (param): this {
        return this._cloneWithParams({
            ... this.params as any, 
            param
        } as PARAMS);
    }

    params: PARAMS = {} as any;

    say(say: string) {
        return this._cloneWithParam({ say });
    }

    retries(retries: number) {
        return this._cloneWithParam({ retries });
    }

    retry() {
        return this.params.retries > 0
            ? this._cloneWithParam({ retries: this.params.retries - 1 })
            : this;
    }

    with(withArgs: WITH) {
        return this._cloneWithParam({ with: withArgs });
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

    return new Router(context => {
        const parseResult = parser(context);
        return typeof parseResult === 'string'
            ? errorRouter
                .getRoute({
                    ... context as any,
                    error: parseResult
                })
            : parsedRouter
                .getRoute(parseResult);
    });
}

function parseText<CONTEXT extends BotContext>(context: CONTEXT) {
    if (context.request.text.length === 0)
        return "Empty String";

    return {
        ... context as any,
        // put text into entities
    }
}

class TextPrompt<WITH extends object = any> extends Prompt<WITH> {
    constructor(
        name: string,
        promptRouterOrHandler: RouterOrHandler<PromptContext<WITH, PromptParams<WITH>, TextPrompt<WITH>>>,
        errorRouterOrHandler?: RouterOrHandler<PromptContext<WITH, PromptParams<WITH>, TextPrompt<WITH>> & IErrorContext>
    ) {
        super(name, parse(parseText, promptRouterOrHandler, errorRouterOrHandler));
    }
}

const choicesToSuggestedActions = (choices: string[]) => {};

interface ChoicePromptParams<WITH extends object = any> extends PromptParams<WITH> {
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

class ChoicePrompt<WITH extends object = any> extends Prompt<WITH, ChoicePromptParams<WITH>> {
    constructor(
        name: string,
        promptRouterOrHandler: RouterOrHandler<PromptContext<WITH, PromptParams<WITH>, TextPrompt<WITH>>>,
        errorRouterOrHandler?: RouterOrHandler<PromptContext<WITH, PromptParams<WITH>, TextPrompt<WITH>> & IErrorContext>
    ) {
        super(name, parse(
            (context: PromptContext<WITH, PromptParams<WITH>, TextPrompt<WITH>>) => parseChoices(context, context.params.choices),
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
        return this._cloneWithParam({ choices });        
    }
}
