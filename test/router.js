"use strict";

const chai = require('chai');
chai.use(require('chai-subset'));
const expect = chai.expect;
const { toObservable, Router, tryInOrder, tryInScoreOrder, run, toScore, routeWithCombinedScore, ifTrue, ifMatches } = require('../dist/prague.js');
const { Observable } = require('rxjs');

const foo = {
    foo: "foo"
}

const notFoo = {
    foo: "notFoo"
}

const bar = {
    bar: "bar"
}

const addBar = (m) => m.foo == "foo" && Object.assign({}, m, bar);

const fooPlusBar = {
    foo: "foo",
    bar: "bar"
}

const throwErr = () => {
    throw new Error();
}

const passErr = (err) => {
    throw err;
}

const noop = () => {}

describe('toObservable', () => {
    it("should convert a number to an observable", (done) => {
        toObservable(5)
            .subscribe(n => {
                expect(n).to.eql(5);
                done();
            });       
    });

    it("should convert a string to an observable", (done) => {
        toObservable("Prague")
            .subscribe(n => {
                expect(n).to.eql("Prague");
                done();
            });
    });

    it("should convert an array to an observable", (done) => {
        toObservable([1, 2, 3])
            .subscribe(n => {
                expect(n).to.eql([1, 2, 3]);
                done();
            });       
    });

    it("should convert a Promise<number> to an observable", (done) => {
        toObservable(Promise.resolve(5))
            .subscribe(n => {
                expect(n).to.eql(5);
                done();
            });       
    });

    it("should convert a Promise<string> to an observable", (done) => {
        toObservable(Promise.resolve("Prague"))
            .subscribe(n => {
                expect(n).to.eql("Prague");
                done();
            });       
    });

    it("should convert a Promise<array> to an observable", (done) => {
        toObservable(Promise.resolve([1, 2, 3]))
            .subscribe(n => {
                expect(n).to.eql([1, 2, 3]);
                done();
            });       
    });

    it("should convert an Observable<number> to an observable", (done) => {
        toObservable(Observable.of(5))
            .subscribe(n => {
                expect(n).to.eql(5);
                done();
            });       
    });

    it("should convert an Observable<string> to an observable", (done) => {
        toObservable(Observable.of("Prague"))
            .subscribe(n => {
                expect(n).to.eql("Prague");
                done();
            });       
    });

    it("should convert an Observable<array> to an observable", (done) => {
        toObservable(Observable.of([1, 2, 3]))
            .subscribe(n => {
                expect(n).to.eql([1, 2, 3]);
                done();
            });       
    });

    it("should convert null to an observable", (done) => {
        toObservable(null)
            .subscribe(n => {
                expect(n).to.eql(null);
                done();
            });       
    });

    it("should convert undefined to an observable", (done) => {
        toObservable(undefined)
            .subscribe(n => {
                expect(n).to.eql(undefined);
                done();
            });       
    });

    it("should convert Promise<null> to an observable", (done) => {
        toObservable(Promise.resolve(null))
            .subscribe(n => {
                expect(n).to.eql(null);
                done();
            });       
    });

    it("should convert Promise<undefined> to an observable", (done) => {
        toObservable(Promise.resolve(undefined))
            .subscribe(n => {
                expect(n).to.eql(undefined);
                done();
            });       
    });

    it("should convert Observable<null> to an observable", (done) => {
        toObservable(Observable.of(null))
            .subscribe(n => {
                expect(n).to.eql(null);
                done();
            });       
    });

    it("should convert Observable<undefined> to an observable", (done) => {
        toObservable(Observable.of(undefined))
            .subscribe(n => {
                expect(n).to.eql(undefined);
                done();
            });       
    });

    it("should complete and never emit on Observable.empty()", (done) => {
        toObservable(Observable.empty())
            .subscribe(throwErr, passErr, done);       
    });

});

describe('Router.actionRoute', () => {
    it('should create an ActionRoute with supplied action and no score', () => {
        let action = () => {};
        let route = Router.actionRoute(action);
        expect(route.type).to.eql('action');
        expect(route.action).to.eql(action);
        expect(route.score).to.eql(1);
    });

    it('should create an ActionRoute with supplied action and score', () => {
        let action = () => {};
        let route = Router.actionRoute(action, 0.5);
        expect(route.type).to.eql('action');
        expect(route.action).to.eql(action);
        expect(route.score).to.eql(.5);
        expect(route.reason).to.be.undefined;
    });
});

describe('Router.do', () => {
    it('should create a router returning an ActionRoute using supplied handler and no score', (done) => {
        let handled;
        Router.do(m => { handled = m; })
            .getRoute(foo)
            .subscribe(route => {
                expect(route.type).to.eql('action');
                expect(route.score).to.eql(1);
                route.action();
                expect(handled).to.eql(foo);
                done();
            });
    });
});

describe('(test code) testRouter', () => {
    it('should route', (done) => {
        let routed;

        const testRouter = new Router(m => Observable.of(Router.actionRoute(
            () => { routed = true; }
        )));

        testRouter
            .getRoute(foo)
            .flatMap(route => toObservable(route.action()))
            .subscribe(n => {
                expect(routed).to.be.true;
                done();
            });
    });
});

describe('Router.noRoute', () => {
    it('should create an ActionRoute with default reason', () => {
        let route = Router.noRoute();
        expect(route.type).to.eql('no');
        expect(route.reason).to.eql('none');
        expect(route.action).to.be.undefined;
        expect(route.score).to.be.undefined;
    });

    it('should create an ActionRoute with supplied reason', () => {
        let route = Router.noRoute('reason');
        expect(route.type).to.eql('no');
        expect(route.reason).to.eql('reason');
        expect(route.action).to.be.undefined;
        expect(route.score).to.be.undefined;
    });
});

describe('Router.no', () => {
    it('should create a router returning a NoRoute with default reason', (done) => {
        Router.no()
            .getRoute(foo)
            .subscribe(route => {
                expect(route.type).to.eql('no');
                expect(route.reason).to.eql('none');
                expect(route.action).to.be.undefined;                
                expect(route.score).to.be.undefined;
                done();
            });
    });

    it('should create a router returning a NoRoute with supplied reason', (done) => {
        Router.no('reason')
            .getRoute(foo)
            .subscribe(route => {
                expect(route.type).to.eql('no');
                expect(route.reason).to.eql('reason');
                expect(route.action).to.be.undefined;                
                expect(route.score).to.be.undefined;
                done();
            });
    });
});

describe('Router.route', () => {
    it("should complete and never emit on Router.no", (done) => {
        Router.no()
            .route(foo)
            .subscribe(throwErr, passErr, done);
    });

    it("should route to testRouter", (done) => {
        let routed;

        const testRouter = new Router(m => Observable.of(Router.actionRoute(
            () => { routed = true; }
        )));

        testRouter
            .route(foo)
            .subscribe(n => {
                expect(routed).to.be.true;
                done();
            });
    });
});

describe("router.beforeDo", () => {
    it("should complete and never emit with Router.no", (done) => {
        Router
            .no()
            .beforeDo(
                throwErr
            )
            .route(foo)
            .subscribe(throwErr, passErr, done)
    });


    it("should run 'before' handler and then router's action", (done) => {
        let handled;
        let routed;
    
        Router
            .do(m => {
                expect(handled).to.be.true;
                routed = true;
            })
            .beforeDo(
                m => {
                    handled = true;
                }
            )
            .route(foo)
            .subscribe(n => {
                expect(routed).to.be.true;
                done();
            });
    });
});

describe("router.afterDo", () => {
    it("should complete and never emit with Router.no", (done) => {
        Router
            .no()
            .afterDo(
                throwErr
            )
            .route(foo)
            .subscribe(throwErr, passErr, done)
    });

    it("should run router's action and then 'after' router when router is supplied", (done) => {
        let handled;
        let routed;
    
        Router
            .do(m => {
                routed = true;
            })
            .afterDo(
                m => {
                    expect(routed).to.be.true;
                    handled = true;
                }
            )
            .route(foo)
            .subscribe(n => {
                expect(handled).to.be.true;
                done();
            });
    });

});

describe("router.defaultDo", () => {
    it("should not be run when router returns an action route", (done) => {
        let routed;
    
        Router
            .do(m => {
                routed = true;
            })
            .defaultDo(throwErr)
            .route(foo)
            .subscribe(n => {
                expect(routed).to.be.true;
                done();
            });
    });

    it("should be run when router returns no route", (done) => {
        let handled;
    
        Router
            .no()
            .defaultDo(m => {
                handled = true;
            })
            .route(foo)
            .subscribe(n => {
                expect(handled).to.be.true;
                done();
            });
    });
});

describe("router.defaultTry", () => {
    it("should not be run when router returns an action route", (done) => {
        let routed;
    
        Router
            .do(m => {
                routed = true;
            })
            .defaultTry(Router.do(throwErr))
            .route(foo)
            .subscribe(n => {
                expect(routed).to.be.true;
                done();
            });
    });
});

describe("router.defaultTry", () => {
    it("should not be run when router returns an action route", (done) => {
        let routed;
    
        Router
            .do(m => {
                routed = true;
            })
            .defaultTry(reason => Router.do(throwErr))
            .route(foo)
            .subscribe(n => {
                expect(routed).to.be.true;
                done();
            });
    });
    
    it("should be run when router returns no route", (done) => {
        let handled;
    
        Router
            .no()
            .defaultTry(reason => Router.do(m => {
                handled = reason;
            }))
            .route(foo)
            .subscribe(n => {
                expect(handled).to.eql('none');
                done();
            });
    });
});

describe('tryInOrder', () => {
    it('should complete and never emit on no routers', (done) =>
        tryInOrder()
            .route(foo)
            .subscribe(throwErr, passErr, done)
    )

    it('should complete and never emit on only null/undefined routers', (done) =>
        tryInOrder(
            null,
            undefined
        )
            .route(foo)
            .subscribe(throwErr, passErr, done)
    );

    it('should complete and never emit on only unsuccessful and null/undefined routers', (done) =>
        tryInOrder(
            Router.no(),
            null,
            undefined
        )
            .route(foo)
            .subscribe(throwErr, passErr, done)
    );

    it('should complete and never emit on no successful routers', (done) => {
        tryInOrder(
            Router.no()
        )
            .route(foo)
            .subscribe(throwErr, passErr, done)
    });

    it('should route to a single successful router', (done) => {
        let routed;

        tryInOrder(
            Router.do(m => {
                routed = true;
            })
        )
            .route(foo)
            .subscribe(n => {
                expect(routed).to.be.true;
                done();
            });
    });

    it('should ignore null/undefined routers and route to a successful router', (done) => {
        let routed;

        tryInOrder(
            null,
            undefined,
            Router.do(m => {
                routed = true;
            })
        )
            .route(foo)
            .subscribe(n => {
                expect(routed).to.be.true;
                done();
            });
    });

    it('should skip an unsuccessful router and route to a successful router', (done) => {
        let routed;

        tryInOrder(
            Router.no(),
            Router.do(m => {
                routed = true;
            })
        )
            .route(foo)
            .subscribe(n => {
                expect(routed).to.be.true;
                done();
            });
    });

});

describe('tryInScoreOrder', () => {
    it('should complete and never emit on no routers', (done) =>
        tryInScoreOrder()
            .route(foo)
            .subscribe(throwErr, passErr, done)
    );

    it('should complete and never emit on only null/undefined routers', (done) =>
        tryInScoreOrder(
            null,
            undefined
        )
            .route(foo)
            .subscribe(throwErr, passErr, done)
    );

    it('should complete and never emit on only unsuccessful and null/undefined routers', (done) =>
        tryInScoreOrder(
            Router.no(),
            null,
            undefined
        )
            .route(foo)
            .subscribe(throwErr, passErr, done)
    );

    it('should complete and never emit on no successful routers', (done) => {
        tryInScoreOrder(
            Router.no()
        )
            .route(foo)
            .subscribe(throwErr, passErr, done)
    });

    it('should route to a single successful scoreless router', (done) => {
        let routed;

        tryInScoreOrder(
            Router.do(m => {
                routed = true;
            })
        )
            .route(foo)
            .subscribe(n => {
                expect(routed).to.be.true;
                done();
            });
    });

    it('should ignore null/undefined routers and route to a successful scoreless router', (done) => {
        let routed;

        tryInScoreOrder(
            null,
            undefined,
            Router.do(m => {
                routed = true;
            })
        )
            .route(foo)
            .subscribe(n => {
                expect(routed).to.be.true;
                done();
            });
    });

    it('should skip an unsuccessful router and route to a successful scoreless router', (done) => {
        let routed;

        tryInScoreOrder(
            Router.no(),
            Router.do(m => {
                routed = true;
            })
        )
            .route(foo)
            .subscribe(n => {
                expect(routed).to.be.true;
                done();
            });
    });

    it('should return the first route where score=1, never trying the rest', (done) => {
        let routed;

        tryInScoreOrder(
            Router.do(m => {
                routed = true;
            }),
            throwErr
        )
            .route(foo)
            .subscribe(n => {
                expect(routed).to.be.true;
                done();
            });
    });

    it('should return the higher scoring route when it is first', (done) => {
        let routed;

        tryInScoreOrder(
            Router.do(_ => { routed = 'first'; }, 0.75),
            Router.do(_ => { routed = 'second'; }, 0.50)
        )
            .route(foo)
            .subscribe(n => {
                expect(routed).to.eql('first');
                done();
            });
    });

    it('should return the higher scoring route when it is second', (done) => {
        let routed;

        tryInScoreOrder(
            Router.do(_ => { routed = 'first'; }, .5),
            Router.do(_ => { routed = 'second'; }, .75)
        )
            .route(foo)
            .subscribe(n => {
                expect(routed).to.eql('second');
                done();
            });
    });

    it('should treat missing scores as 1', (done) => {
        let routed;

        tryInScoreOrder(
            Router.do(_ => { routed = 'first'; }),
            Router.do(_ => { routed = 'second'; }, .75)
        )
            .route(foo)
            .subscribe(n => {
                expect(routed).to.eql('first');
                done();
            });
    });

    it('should return the first of two tied scores', (done) => {
        let routed;

        tryInScoreOrder(
            Router.do(_ => { routed = 'first'; }, 0.75),
            Router.do(_ => { routed = 'second'; }, 0.75)
        )
            .route(foo)
            .subscribe(n => {
                expect(routed).to.eql('first');
                done();
            });
    });
});

describe('Router.noop', () => {
    it("should execute the handler, complete, and never emit", (done) => {
        let routed;

        Router.noop(
            m => {
                routed = true;
            }
        )
            .route(foo)
            .subscribe(throwErr, passErr, _ => {
                expect(routed).to.be.true;
                done()
            })
    })
});

describe('routeWithCombinedScore', () => {
    it("should return combined score", () => {
        expect(routeWithCombinedScore(
            Router.actionRoute(() => {}, .4),
            .25
        ).score).to.eql(.1);
    });
})

describe('ifTrue', () => {
    it("should complete and never emit on false when 'else' router doesn't exist", (done) =>
        ifTrue(m => false)
            .thenDo(throwErr)
            .route(foo)
            .subscribe(throwErr, passErr, done)
    );

    it("should complete and never emit on false when 'else' router doesn't route", (done) =>
        ifTrue(m => false)
            .thenDo(throwErr)
            .elseTry(Router.no())
            .route(foo)
            .subscribe(throwErr, passErr, done)
    );

    it("should complete and never emit on true when 'if' router doesn't route and 'else' router doesn't exist", (done) =>
        ifTrue(m => true)
            .thenTry(Router.no())
            .route(foo)
            .subscribe(throwErr, passErr, done)
    );

    it("should complete and never emit on true when 'if' router doesn't route and 'else' router exists", (done) =>
        ifTrue(m => true)
            .thenTry(Router.no())
            .elseDo(throwErr)
            .route(foo)
            .subscribe(throwErr, passErr, done)
    );

    it("should route message to 'if' handler on true predicate when 'else' router doesn't exist", (done) => {
        let routed;

        ifTrue(m => true)
            .thenDo(m => {
                routed = true;
            })
            .route(foo)
            .subscribe(n => {
                expect(routed).to.be.true;
                done();
            });
    });

    it("should route message to 'if' handler on true predicate when 'else' router exists", (done) => {
        let routed;

        ifTrue(m => true)
            .thenDo(m => {
                routed = true;
            })
            .elseDo(throwErr)
            .route(foo)
            .subscribe(n => {
                expect(routed).to.be.true;
                done();
            });
    });

    it("should route message to 'if' router on true predicate when 'else' router doesn't exist", (done) => {
        let routed;

        ifTrue(m => true)
            .thenTry(Router.do(m => {
                routed = true;
            }))
            .route(foo)
            .subscribe(n => {
                expect(routed).to.be.true;
                done();
            });
    });

    it("should route message to 'if' router on true predicate when 'else' router exists", (done) => {
        let routed;

        ifTrue(m => true)
            .thenTry(Router.do(m => {
                routed = true;
            }))
            .elseDo(throwErr)
            .route(foo)
            .subscribe(n => {
                expect(routed).to.be.true;
                done();
            });
    });

    it("should route message to 'else' handler on false predicate", (done) => {
        let routed;

        ifTrue(m => false)
            .thenDo(throwErr)
            .elseDo(m => {
                routed = true;
            })
            .route(foo)
            .subscribe(n => {
                expect(routed).to.be.true;
                done();
            });
    });

    it("should route message to 'else' router on false predicate", (done) => {
        let routed;

        ifTrue(m => false)
            .thenDo(throwErr)
            .elseTry(Router.do(m => {
                routed = true;
            }))
            .route(foo)
            .subscribe(n => {
                expect(routed).to.be.true;
                done();
            });
    });

    it("should return score=1 on true predicate when 'if' score undefined", (done) => {
        ifTrue(m => true)
            .thenDo(m => {})
            .getRoute(foo)
            .subscribe(route => {
                expect(route.score).to.eql(1);
                done();
            });
    });

    it("should return route score on true predicate", (done) => {
        ifTrue(m => true)
            .thenTry(Router.do(() => {}, 0.25))
            .getRoute(foo)
            .subscribe(route => {
                expect(route.score).to.eql(.25);
                done();
            });
    });

    it("should return score=1 on false predicate when 'else' score undefined", (done) => {
        ifTrue(m => false)
            .thenDo(throwErr)
            .elseDo(m => {})
            .getRoute(foo)
            .subscribe(route => {
                expect(route.score).to.eql(1);
                done();
            });
    });

    it("should return 'else' route score on false predicate", (done) => {
        ifTrue(m => false)
            .thenDo(throwErr)
            .elseTry(Router.do(_ => {}, .5))
            .getRoute(foo)
            .subscribe(route => {
                expect(route.score).to.eql(.5);
                done();
            });
    });

    it("should throw on string", (done) => {
        ifTrue(m => 'foo')
            .thenDo(throwErr)
            .getRoute(foo)
            .subscribe(throwErr, error => {
                done();
            }, throwErr);
    });

    it("should throw on object", (done) => {
        ifTrue(m => ({ foo: "foo" }))
            .thenDo(throwErr)
            .getRoute(foo)
            .subscribe(throwErr, error => {
                done();
            }, throwErr);
    });

    it("should return a default reason on false", (done) => {
        ifTrue(m => false)
            .thenDo(throwErr)
            .getRoute(foo)
            .subscribe(route => {
                expect(route.reason).to.eql("none");
                done();
            });
    });

    it("should return supplied reason", (done) => {
        ifTrue(m => ({ reason: 'whatevs' }))
            .thenDo(throwErr)
            .getRoute(foo)
            .subscribe(route => {
                expect(route.reason).to.eql("whatevs");
                done();
            });
    });

    it("should use formal true result", (done) => {
        let handled;

        ifTrue(m => ({ result: true, score: .5 }))
            .thenDo(m => { handled = true; })
            .getRoute(foo)
            .subscribe(route => {
                route.action();
                expect(handled).to.be.true;
                expect(route.score).to.eql(.5);
                done();
            });
    });

    it("should use formal false result", (done) => {
        let handled;

        ifTrue(m => ({ result: false }))
            .thenDo(throwErr)
            .getRoute(foo)
            .subscribe(route => {
                expect(route.type).to.eql('no')
                done();
            });
    });
});

describe('ifMatches', () => {
    it("should complete and never emit on no match when 'else' router doesn't exist", (done) =>
        ifMatches(addBar)
            .thenDo(throwErr)
            .route(notFoo)
            .subscribe(throwErr, passErr, done)
    );

    it("should complete and never emit on no match when 'else' router doesn't exist", (done) =>
        ifMatches(addBar)
            .thenTry(Router.do(throwErr))
            .route(notFoo)
            .subscribe(throwErr, passErr, done)
    );

    it("should complete and never emit on no match when 'else' router doesn't route", (done) =>
        ifMatches(addBar)
            .thenDo(throwErr)
            .elseTry(Router.no())
            .route(notFoo)
            .subscribe(throwErr, passErr, done)
    );

    it("should complete and never emit on match when 'if' router doesn't route and 'else' router exists", (done) =>
        ifMatches(addBar)
            .thenTry(Router.no())
            .elseDo(throwErr)
            .route(foo)
            .subscribe(throwErr, passErr, done)
    );

    it("should route message to 'if' handler on match when 'else' router doesn't exist", (done) => {
        let routed;

        ifMatches(addBar)
            .thenDo(m => {
                routed = true;
            })
            .route(foo)
            .subscribe(n => {
                expect(routed).to.be.true;
                done();
            })
    });

    it("should route message to 'if' handler on match when 'else' router exists", (done) => {
        let routed;

        ifMatches(addBar)
            .thenDo(m => {
                routed = true;
            })
            .elseDo(throwErr)
            .route(foo)
            .subscribe(n => {
                expect(routed).to.be.true;
                done();
            })
    });

    it("should route message to 'else' handler on no match", (done) => {
        let routed;

        ifMatches(addBar)
            .thenDo(throwErr)
            .elseDo(m => {
                routed = true;
            })
            .route(notFoo)
            .subscribe(n => {
                expect(routed).to.be.true;
                done();
            })
    });

    it("should route message to 'else' router on no match", (done) => {
        let routed;

        ifMatches(addBar)
            .thenDo(throwErr)
            .elseTry(Router.do(m => {
                routed = true;
            }))
            .route(notFoo)
            .subscribe(n => {
                expect(routed).to.be.true;
                done();
            })
    });

    it("should return score=1 when score not supplied", (done) => {
        ifMatches(addBar)
            .thenDo(m => {})
            .getRoute(foo)
            .subscribe(route => {
                expect(route.score).to.eql(1);
                done();
            })
    });

    it("should return supplied score", (done) => {
        ifMatches(m => ({ result: 'dog', score: 0.4 }))
            .thenDo(m => {})
            .getRoute(foo)
            .subscribe(route => {
                expect(route.score).to.eql(.4);
                done();
            })
    });

    it("should return combined score when route score supplied", (done) => {
        ifMatches(addBar)
            .thenTry(Router.do(() => {}, .25))
            .getRoute(foo)
            .subscribe(route => {
                expect(route.score).to.eql(.25);
                done();
            })
    });
    
    it("should return combined score when both scores supplied", (done) => {
        ifMatches(m => ({ result: 'cat', score: 0.4 }))
            .thenTry(Router.do(() => {}, .25))
            .getRoute(foo)
            .subscribe(route => {
                expect(route.score).to.eql(.1);
                done();
            })
    });

    it("should return 'else' route score on no match", (done) => {
        ifMatches(addBar)
            .thenDo(throwErr)
            .elseTry(Router.do(() => {}, .5))
            .getRoute(notFoo)
            .subscribe(route => {
                expect(route.score).to.eql(.5);
                done();
            })
    });
});
