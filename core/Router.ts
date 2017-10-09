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

export interface BaseRoute {
    score?: number;
}

export interface ActionRoute extends BaseRoute {
    type: 'action';
    action: () => Observableable<any>;
}

export interface AbstractRoute extends BaseRoute {
    type: 'abstract';
    name: string;
    value?: object;
}

export type Route = ActionRoute | AbstractRoute;

export interface Routable {
    score?: number;
}

export interface Handler <Z extends Routable = {}> {
    (m: Z): Observableable<any>;
}

export type RouterOrHandler <M extends Routable = {}> = Router<M> | Handler<M>;

export interface AbstractRouteNameValue {
    name: string,
    value?: object
}

export interface GetRoute <M extends Routable> {
    (m: M): Observable<Route>;
}

export class Router <M extends Routable> {
    constructor(public getRoute: GetRoute<M>) {}

    static fromHandler <M extends Routable> (handler: Handler<M>) {
        return new Router<M>(m => Observable.of({
            type: 'action',
            action: () => handler(m)
        } as Route));
    }
    
    static null = new Router<any>(m => Observable.empty());

    static from <M extends Routable> (routerOrHandler: RouterOrHandler<M>): Router<M> {
        return routerOrHandler
            ? routerOrHandler instanceof Router
                ? routerOrHandler
                : Router.fromHandler(routerOrHandler)
            : Router.null;
    }

    static routersFrom <M extends Routable> (routersOrHandlers: RouterOrHandler<M>[]) {
        return routersOrHandlers
            .map(routerOrHandler => Router.from(routerOrHandler));
    }
    
    static abstractRouteWarning = (route: AbstractRoute) => m => {
        console.warn(`An attempt was made to execute an abstract route named ${route.name} with value ${route.value}`);
    }
    
    static abstractRoute <M extends Routable> (name: string, value?: object): Router<M>;
    static abstractRoute <M extends Routable> (getAbstractRouteNameValue: (m: M) => Observableable<AbstractRouteNameValue>): Router<M>;
    static abstractRoute <M extends Routable> (... args): Router<M> {
        return new Router(typeof args[0] === 'string'
            ? m => Observable.of({
                    type: 'abstract',
                    name: args[0],
                    value: args[1]
                } as Route) 
            : m => toObservable(args[0](m))
                .map((nameValue: AbstractRouteNameValue) => ({
                    type: 'abstract',
                    ... nameValue
                } as Route))
        );
    }
    
    catchAbstractRoute(getRouter: (route: AbstractRoute) => RouterOrHandler<M>): Router<M> {
        return new Router(m => this
            .getRoute(m)
            .flatMap(route => route.type === "abstract"
                ? Router.from(getRouter(route)).getRoute(m)
                : Observable.of(route)
            )
        );
    }

    route (m: M) {
        return this
            .catchAbstractRoute(Router.abstractRouteWarning)
            .getRoute(m)
            .do(route => konsole.log("route: returned a route", route))
            .flatMap((route: ActionRoute) => toObservable(route.action()))
            .do(_ => konsole.log("route: called action"));
    }

    doBefore (handler: Handler<M>) {
        return new BeforeRouter(handler, this);
    }

    doAfter (handler: Handler<M>) {
        return new AfterRouter(handler, this);
    }

}

export class FirstRouter <M extends Routable> extends Router<M> {
    constructor (... routersOrHandlers: RouterOrHandler<M>[]) {
        const router$ = Observable.from(Router.routersFrom(routersOrHandlers));
        super(m => router$
            .concatMap((router, i) => {
                konsole.log(`first: trying router #${i}`);
                return router
                    .getRoute(m)
                    .do(n => konsole.log(`first: router #${i} succeeded`, n));
            })
            .take(1) // so that we don't keep going through routers after we find one that matches
        );    
    }
}

export function first <M extends Routable> (... routersOrHandlers: RouterOrHandler<M>[]) {
    return new FirstRouter(... routersOrHandlers);
}

export function toScore (score: number) {
    return score == null ? 1 : score;
}

export class BestRouter <M extends Routable> extends Router<M> {
    private static minRoute: Route = {
        type: 'action',
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

export class IfTrueRouter <M extends Routable> extends Router<M> {
    constructor (
        predicate: Predicate<M>,
        thenRouterOrHandler: RouterOrHandler<M>,
        elseRouterOrHandler?: RouterOrHandler<M>,
    ) {
        const thenRouter = Router.from(thenRouterOrHandler);
        const elseRouter = Router.from(elseRouterOrHandler);

        super(m => toObservable(predicate(m))
            .flatMap(n => n
                ? thenRouter.getRoute(m)
                : elseRouter.getRoute(m)
            )
        );
    }
}

export function ifTrue <M extends Routable> (
    predicate: Predicate<M>,
    thenRouterOrHandler: RouterOrHandler<M>,
    elseRouterOrHandler?: RouterOrHandler<M>
): IfTrueRouter<M> {
    return new IfTrueRouter(predicate, thenRouterOrHandler, elseRouterOrHandler);
}

export interface Matcher <M extends Routable = {}, Z extends Routable = {}> {
    (m: M): Observableable<Z>;
}

export class IfMatchesRouter <M extends Routable, N extends Routable> extends Router<M> {
    private static routeWithCombinedScore(route: Route, newScore: number) {
        const score = toScore(newScore) * toScore(route.score);
    
        return toScore(route.score) === score
            ? route
            : {
                ... route,
                score
            } as Route;
    }

    constructor (
        matcher: Matcher<M, N>,
        thenRouterOrHandler: RouterOrHandler<N>,
        elseRouterOrHandler?: RouterOrHandler<M>
    ) {
        const thenRouter = Router.from(thenRouterOrHandler);
        const elseRouter = Router.from(elseRouterOrHandler);

        super(m => toObservable(matcher(m))
            .flatMap(n => n
                ? thenRouter
                    .getRoute(n)
                    .map(route => IfMatchesRouter.routeWithCombinedScore(route, n.score))    
                : elseRouter
                    .getRoute(m)
            )
        );
    }
}

export function ifMatches <M extends Routable, N extends Routable> (
    matcher: Matcher<M, N>,
    thenRouterOrHandler: RouterOrHandler<N>,
    elseRouterOrHandler?: RouterOrHandler<M>
): IfMatchesRouter<M, N> {
    return new IfMatchesRouter(matcher, thenRouterOrHandler, elseRouterOrHandler);
}

export class BeforeRouter <M extends Routable> extends Router<M> {
    constructor (beforeHandler: Handler<M>, routerOrHandler: RouterOrHandler<M>) {
        const router = Router
            .from(routerOrHandler)
            .catchAbstractRoute(Router.abstractRouteWarning);

        super(m => router
            .getRoute(m)
            .map((route: ActionRoute) => ({
                ... route,
                action: () => toObservable(beforeHandler(m))
                    .flatMap(_ => toObservable(route.action()))
            }))
        );
    }
}

export class AfterRouter <M extends Routable> extends Router<M> {
    constructor (afterHandler: Handler<M>, routerOrHandler: RouterOrHandler<M>) {
        const router = Router
            .from(routerOrHandler)
            .catchAbstractRoute(Router.abstractRouteWarning);

        super(m => router
            .getRoute(m)
            .map((route: ActionRoute) => ({
                ... route,
                action: () => toObservable(route.action())
                    .flatMap(_ => toObservable(afterHandler(m)))
            }))
        );
    }
}
