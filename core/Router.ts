import { konsole } from './Konsole';
import { Observable } from 'rxjs';

export type Observableable <T> = T | Observable<T> | Promise<T>;

export function toObservable <T> (t: Observableable<T>) {
    if (t instanceof Observable)
        return t;
    if (t instanceof Promise)
        return Observable.fromPromise<T> (t);
    return Observable.of(t);
}

export function toFilteredObservable <T> (t: Observableable<T>) {
    if (!t)
        return Observable.empty<T>();
    if (t instanceof Observable)
        return t.filter(i => !!i);
    if (t instanceof Promise)
        return Observable.fromPromise<T> (t).filter(i => !!i);
    return Observable.of(t);
}

export interface Route {
    score?: number;
    thrown?: true;
    action: () => Observableable<any>;
}

export type Routable  = object;

export interface Handler <Z extends Routable = {}> {
    (m: Z): Observableable<any>;
}

export class Router <M extends Routable> {
    constructor(public getRoute: (m: M) => Observable<Route>) {}

    static do <M extends Routable> (handler: Handler<M>) {
        return new Router<M>(m => Observable.of({
            action: () => handler(m)
        } as Route));
    }
    
    static null = new Router<any>(m => Observable.empty());

    route (m: M) {
        return this
            .getRoute(m)
            .do(route => konsole.log("route: returned a route", route))
            .flatMap(route => toObservable(route.action()))
            .do(_ => konsole.log("route: called action"));
    }

    beforeDo (handler: Handler<M>) {
        return new BeforeRouter<M>(handler, this);
    }

    afterDo (handler: Handler<M>) {
        return new AfterRouter<M>(handler, this);
    }

    defaultDo (handler: Handler<M>) {
        return new DefaultRouter<M>(this, Router.do(handler));
    }

    defaultTry (router: Router<M>) {
        return new DefaultRouter<M>(this, router);
    }

}

export class FirstRouter <M extends Routable> extends Router<M> {
    constructor (... routers: Router<M>[]) {
        super(m => Observable.from(routers)
            .concatMap((router, i) => {
                konsole.log(`first: trying router #${i}`);
                return router
                    .getRoute(m)
                    .do(n => konsole.log(`first: router #${i} succeeded`, n));
            })
            .take(1) // so that we don't keep going through routers after we find one that matches);
        );
    }
}

export function tryInOrder <M extends Routable> (... routers: Router<M>[]) {
    return new FirstRouter(... routers);
}

export function toScore (score: number) {
    return score == null ? 1 : score;
}

/*
export class BestRouter <M extends Routable> extends Router<M> {
    private static minRoute: Route = {
        score: 0,
        action: () => {
            console.warn("BestRouter.minRoute.action should never be called");
        }
    }
    
    constructor(... routersOrHandlers: RouterOrHandler<M>[]) {
        const router$ = Observable.from(Router.routersFrom(routersOrHandlers)); 
        super(m => new Observable<Route>(observer => {
            let bestRoute: Route = BestRouter.minRoute;

            const subscription = router$
                .takeWhile(_ => toScore(bestRoute.score) < 1)
                .concatMap(router => router.getRoute(m))
                .subscribe(
                    route => {
                        if (toScore(route.score) > toScore(bestRoute.score)) {
                            bestRoute = route;
                            if (toScore(bestRoute.score) === 1) {
                                observer.next(bestRoute);
                                observer.complete();
                            }
                        }
                    },
                    error =>
                        observer.error(error),
                    () => {
                        if (toScore(bestRoute.score) > 0)
                            observer.next(bestRoute);
                        observer.complete();
                    }
                );

            return () => subscription.unsubscribe();
        }));
    }
}

export function best <M extends Routable> (... routersOrHandlers: RouterOrHandler<M>[]) {
    return new BestRouter(... routersOrHandlers);
}
*/

export class RunRouter <M extends Routable> extends Router<M> {
    constructor(handler: Handler<M>) {
        super(m => toObservable(handler(m))
            .filter(_ => false)
        );
    }
}

export function run <M extends Routable> (handler: Handler<M>) {
    return new RunRouter(handler);
}

export interface Predicate <M extends Routable = {}> {
    (m: M): Observableable<boolean>;
}

export class IfTrueElse <M extends Routable> extends Router<M> {
    constructor(
        private predicate: Predicate<M>,
        private thenRouter: Router<M>,
        private elseRouter: Router<M>
    ) {
        super(m => toObservable(predicate(m))
            .flatMap(result => result
                ? thenRouter.getRoute(m)
                : elseRouter.getRoute(m)
            )
        );
    }
}

export class IfTrueThen <M extends Routable> extends Router<M> {
    constructor(
        private predicate: Predicate<M>,
        private thenRouter: Router<M>
    ) {
        super(m => toFilteredObservable(predicate(m))
            .flatMap(_ => thenRouter.getRoute(m))
        );
    }

    elseDo(handler: Handler<M>) {
        return new IfTrueElse(this.predicate, this.thenRouter, Router.do(handler))
    }

    elseTry(router: Router<M>) {
        return new IfTrueElse(this.predicate, this.thenRouter, router)
    }
}

export class IfTrue <M extends Routable> {
    constructor (
        private predicate: Predicate<M>
    ) {
    }

    thenDo(handler: Handler<M>) {
        return new IfTrueThen(this.predicate, Router.do(handler));
    }

    thenTry(router: Router<M>) {
        return new IfTrueThen(this.predicate, router);
    }
}

export function ifTrue <M extends Routable> (
    predicate: Predicate<M>
): IfTrue<M> {
    return new IfTrue(predicate);
}

export interface MatcherResult<RESULT = any> {
    result: RESULT;
    score?: number;
}

export interface HandlerWithResult <Z extends Routable = {}, RESULT = any> {
    (m: Z, r?: RESULT): Observableable<any>;
}

export interface Matcher <M extends Routable = {}, RESULT = any> {
    (m: M): Observableable<MatcherResult<RESULT>>;
}

function routeWithCombinedScore(route: Route, newScore: number) {
    const score = toScore(newScore) * toScore(route.score);

    return toScore(route.score) === score
        ? route
        : {
            ... route,
            score
        } as Route;
}

export class IfMatchesElse <M extends Routable, RESULT = any> extends Router<M> {
    constructor(
        private matcher: Matcher<M, RESULT>,
        private getRouter: (result: RESULT) => Router<M>,
        private elseRouter: Router<M>
    ) {
        super(m => toObservable(matcher(m))
            .flatMap(matcherResult => matcherResult
                ? getRouter(matcherResult.result)
                    .getRoute(m)
                    .map(route => routeWithCombinedScore(route, matcherResult.score))    
                : elseRouter
                    .getRoute(m)
            )
        );
    }
}

export class IfMatchesThen <M extends Routable, RESULT = any> extends Router<M> {
    constructor(
        private matcher: Matcher<M, RESULT>,
        private getRouter: (result: RESULT) => Router<M>
    ) {
        super(m => toFilteredObservable(matcher(m))
            .flatMap(matcherResult => getRouter(matcherResult.result)
                .getRoute(m)
                .map(route => routeWithCombinedScore(route, matcherResult.score))
            )
        );
    }

    elseDo(handler: Handler<M>) {
        return new IfMatchesElse(this.matcher, this.getRouter, Router.do(handler))
    }

    elseTry(router: Router<M>) {
        return new IfMatchesElse(this.matcher, this.getRouter, router)
    }
}

export class IfMatches <M extends Routable, RESULT = any> {
    constructor (
        private matcher: Matcher<M, RESULT>
    ) {
    }

    thenDo(handlerWithResult: HandlerWithResult<M, RESULT>) {
        return new IfMatchesThen(this.matcher, result => Router.do(m => handlerWithResult(m, result)));
    }

    thenTry(router: Router<M>): IfMatchesThen<M, RESULT>;
    thenTry(getRouter: (result: RESULT) => Router<M>): IfMatchesThen<M, RESULT>;
    thenTry(arg) {
        return new IfMatchesThen(this.matcher, typeof arg !== 'function'
            ? result => arg
            : arg
        );
    }
}

export function ifMatches <M extends Routable, RESULT = any> (
    matcher: Matcher<M, RESULT>
): IfMatches<M, RESULT> {
    return new IfMatches(matcher);
}

/*
const thrownRoute: Route = {
    thrown: true,
    action: () => {}
};

export function throwRoute <M extends Routable> () {
    return new Router<M>(m => Observable.of(thrownRoute));
}

export function catchRoute <M extends Routable> (routerOrHandler: RouterOrHandler<M>): Router<M> {
    return new Router<M>(m => Router
        .from(routerOrHandler)
        .getRoute(m)
        .filter(route => !route.thrown)
    );
}
*/

export class BeforeRouter <M extends Routable> extends Router<M> {
    constructor (beforeHandler: Handler<M>, router: Router<M>) {
        super(m => router
            .getRoute(m)
            .map(route => ({
                ... route,
                action: () => toObservable(beforeHandler(m))
                    .flatMap(_ => toObservable(route.action()))
            }))
        );
    }
}

export class AfterRouter <M extends Routable> extends Router<M> {
    constructor (afterHandler: Handler<M>, router: Router<M>) {
        super(m => router
            .getRoute(m)
            .map(route => ({
                ... route,
                action: () => toObservable(route.action())
                    .flatMap(_ => toObservable(afterHandler(m)))
            }))
        );
    }
}

export class DefaultRouter <M extends Routable> extends Router<M> {
    constructor (mainRouter: Router<M>, defaultRouter: Router<M>) {
        super(m => Observable.from([mainRouter, defaultRouter])
            .concatMap(router => router.getRoute(m))
            .take(1) // so that we don't keep going through routers after we find one that matches);
        );
    }
}

// Sample code

function ifRegExp <M extends Routable = {} >(regexp: RegExp) {
    const matchRegExp = m => {
        const result = regexp.exec((m as any).request.text);
        return result && {
            result
        }
    }

    return new IfMatches<M, RegExpExecArray>(matchRegExp);
}

ifTrue(c => true)
    .thenDo(c => console.log("true"))
    .elseTry(
        ifTrue(c => true).thenDo(c => console.log("false"))
    )

ifTrue(c => true).thenTry(
    tryInOrder(
        ifTrue(c => true).thenDo(c => console.log("hi")),
        ifTrue(c => false).thenDo(c => console.log("bye"))
    )
    .defaultDo(c => console.log("huh?"))
)

ifRegExp(/foo/i)
    .thenDo(c => console.log("matches!"))

ifRegExp(/Go to (.*)/i)
    .thenDo((c, matches) => console.log(`Let's go to ${matches[0]}`))

ifRegExp(/Go to (.*)/i).thenTry(
    tryInOrder(
        ifTrue(c => false).thenDo(c => console.log("hi")),
        ifTrue(c => false).thenDo(c => console.log("bye"))
    )
    .defaultDo(c => console.log("huh?"))
)

ifRegExp(/Go to (.*)/i).thenTry(matches =>
    tryInOrder(
        ifTrue(c => false).thenDo(c => console.log(`We're going to ${matches[0]}`)),
        ifTrue(c => false).thenDo(c => console.log("bye"))
    )
    .defaultDo(c => console.log("huh?"))
)
