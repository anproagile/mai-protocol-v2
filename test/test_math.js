const assert = require('assert');
const BigNumber = require('bignumber.js');
const TestSignedMath = artifacts.require('TestSignedMath');
const TestUnsignedMath = artifacts.require('TestUnsignedMath');
const { toWei, fromWei, toWad, fromWad, infinity, Side } = require('./constants');

contract('testMath', accounts => {

    let testSignedMath, testUnsignedMath;

    const deploy = async () => {
        testSignedMath = await TestSignedMath.new();
        testUnsignedMath = await TestUnsignedMath.new();
    };

    before(deploy);

    it("frac1", async () => {
        let r;
        let s;
        let c = "300000000000000";
        r = await testUnsignedMath.wfrac("1111111111111111111", "500000000000000000", c);
        s = await testUnsignedMath.wmul("1111111111111111111", "500000000000000000");
        s = await testUnsignedMath.wdiv(s.toString(), c);
        // A*B -> A*B +(-) 1E-18
        // A*B/C -> [A*B +(-) 1E-18]/C +(-) 1E-18 -> A*B/C +(-) 1E-18/C +(-) 1E-18
        // diff -> -(1E-18/C + 1E-18) ~ (1E-18/C + 1E-18)
        const diff = await testUnsignedMath.wdiv(1, c);
        console.log("         R:", r.toString());
        console.log("         S:", s.toString());
        console.log("DIFF RANGE:", diff.toString());
        assert.ok(r.sub(s).abs() <= Number(diff.toString())) + 1;
    });

    it("frac2 neg", async () => {
        let r;
        let s;
        r = await testSignedMath.wfrac("-1111111111111111111", "500000000000000000", "300000000000000000");
        s = await testSignedMath.wmul("-1111111111111111111", "500000000000000000");
        s = await testSignedMath.wdiv(s.toString(), "300000000000000000");
        assert.ok(r.sub(s).abs() <= 1);
    });

    it("roundHalfUp", async () => {
        assert.equal((await testSignedMath.roundHalfUp(toWei(1.2), toWei(1))).toString(), toWei(1.7).toString());
        assert.equal((await testSignedMath.roundHalfUp(toWei(1.5), toWei(1))).toString(), toWei(2.0).toString());
        assert.equal((await testSignedMath.roundHalfUp(toWei(1.2344), toWei(0.001))).toString(), toWei(1.2349).toString());
        assert.equal((await testSignedMath.roundHalfUp(toWei(1.2345), toWei(0.001))).toString(), toWei(1.2350).toString());

        assert.equal((await testSignedMath.roundHalfUp(toWei(-1.2), toWei(1))).toString(), toWei(-1.7).toString());
        assert.equal((await testSignedMath.roundHalfUp(toWei(-1.5), toWei(1))).toString(), toWei(-2.0).toString());
        assert.equal((await testSignedMath.roundHalfUp(toWei(-1.2344), toWei(0.001))).toString(), toWei(-1.2349).toString());
        assert.equal((await testSignedMath.roundHalfUp(toWei(-1.2345), toWei(0.001))).toString(), toWei(-1.2350).toString());
    });

    it("unsigned wmul - trivial", async () => {
        // (2**128 - 1) * 1 = (2**128 - 1)
        assert.equal((await testUnsignedMath.wmul('340282366920938463463374607431768211455', toWad(1))).toString(), '340282366920938463463374607431768211455');
        assert.equal((await testUnsignedMath.wmul(toWad(0), toWad(0))).toString(), '0');
        assert.equal((await testUnsignedMath.wmul(toWad(0), toWad(1))).toString(), '0');
        assert.equal((await testUnsignedMath.wmul(toWad(1), toWad(0))).toString(), '0');
        assert.equal((await testUnsignedMath.wmul(toWad(1), toWad(1))).toString(), toWad(1).toString());
        assert.equal((await testUnsignedMath.wmul(toWad(1), toWad(0.2))).toString(), toWad(0.2).toString());
        assert.equal((await testUnsignedMath.wmul(toWad(2), toWad(0.2))).toString(), toWad(0.4).toString());
    });

    it("unsigned wmul - overflow", async () => {
        try {
            // 2**128 * 2**128
            await testUnsignedMath.wmul('340282366920938463463374607431768211456', '340282366920938463463374607431768211456');
            assert.fail('should overflow');
        } catch {
        }
    });

    it("unsigned wmul - rounding", async () => {
        assert.equal((await testUnsignedMath.wmul('1', '499999999999999999')).toString(), '0');
        assert.equal((await testUnsignedMath.wmul('1', '500000000000000000')).toString(), '1');
        assert.equal((await testUnsignedMath.wmul('950000000000005647', '1000000000')).toString(), '950000000');
        assert.equal((await testUnsignedMath.wmul('1000000000', '950000000000005647')).toString(), '950000000');
    });

    it("unsigned wdiv - trivial", async () => {
        assert.equal((await testUnsignedMath.wdiv('0', toWad(1))).toString(), '0');
        assert.equal((await testUnsignedMath.wdiv(toWad(1), toWad(1))).toString(), toWad(1).toString());
        assert.equal((await testUnsignedMath.wdiv(toWad(1), toWad(2))).toString(), toWad(0.5).toString());
        assert.equal((await testUnsignedMath.wdiv(toWad(2), toWad(2))).toString(), toWad(1).toString());
    });

    it("unsigned wdiv - div by 0", async () => {
        try {
            await testUnsignedMath.wdiv(toWad(1), toWad(0));
            assert.fail('div by 0');
        } catch {
        }
    });

    it("unsigned wdiv - rounding", async () => {
        assert.equal((await testUnsignedMath.wdiv('499999999999999999', '1000000000000000000000000000000000000')).toString(), '0');
        assert.equal((await testUnsignedMath.wdiv('500000000000000000', '1000000000000000000000000000000000000')).toString(), '1');
        assert.equal((await testUnsignedMath.wdiv(toWad(1), toWad(3))).toString(), '333333333333333333');
        assert.equal((await testUnsignedMath.wdiv(toWad(2), toWad(3))).toString(), '666666666666666667');
        assert.equal((await testUnsignedMath.wdiv(toWad(1), 3)).toString(), '333333333333333333333333333333333333');
        assert.equal((await testUnsignedMath.wdiv(toWad(2), 3)).toString(), '666666666666666666666666666666666667');

    });

    it("signed wmul - trivial", async () => {
        // (2**128 - 1) * 1
        assert.equal((await testSignedMath.wmul('340282366920938463463374607431768211455', toWad(1))).toString(), '340282366920938463463374607431768211455');
        assert.equal((await testSignedMath.wmul(toWad(0), toWad(0))).toString(), '0');
        assert.equal((await testSignedMath.wmul(toWad(0), toWad(1))).toString(), '0');
        assert.equal((await testSignedMath.wmul(toWad(1), toWad(0))).toString(), '0');
        assert.equal((await testSignedMath.wmul(toWad(1), toWad(1))).toString(), toWad(1).toString());
        assert.equal((await testSignedMath.wmul(toWad(1), toWad(0.2))).toString(), toWad(0.2).toString());
        assert.equal((await testSignedMath.wmul(toWad(2), toWad(0.2))).toString(), toWad(0.4).toString());

        // (-2**128) * 1
        assert.equal((await testSignedMath.wmul('-340282366920938463463374607431768211456', toWad(1))).toString(), '-340282366920938463463374607431768211456');
        assert.equal((await testSignedMath.wmul(toWad(0), toWad(-1))).toString(), '0');
        assert.equal((await testSignedMath.wmul(toWad(-1), toWad(0))).toString(), '0');
        assert.equal((await testSignedMath.wmul(toWad(-1), toWad(1))).toString(), toWad(-1).toString());
        assert.equal((await testSignedMath.wmul(toWad(1), toWad(-1))).toString(), toWad(-1).toString());
        assert.equal((await testSignedMath.wmul(toWad(-1), toWad(-1))).toString(), toWad(1).toString());
        assert.equal((await testSignedMath.wmul(toWad(1), toWad(-0.2))).toString(), toWad(-0.2).toString());
        assert.equal((await testSignedMath.wmul(toWad(2), toWad(-0.2))).toString(), toWad(-0.4).toString());
        assert.equal((await testSignedMath.wmul(toWad(-1), toWad(0.2))).toString(), toWad(-0.2).toString());
        assert.equal((await testSignedMath.wmul(toWad(-2), toWad(0.2))).toString(), toWad(-0.4).toString());
        assert.equal((await testSignedMath.wmul(toWad(-1), toWad(-0.2))).toString(), toWad(0.2).toString());
        assert.equal((await testSignedMath.wmul(toWad(-2), toWad(-0.2))).toString(), toWad(0.4).toString());
    });

    it("signed wmul - overflow", async () => {
        try {
            // 2**128 * 2**128
            await testSignedMath.wmul('340282366920938463463374607431768211456', '340282366920938463463374607431768211456');
            assert.fail('should overflow');
        } catch {
        }

        try {
            // -2**128 * -2**128
            await testSignedMath.wmul('-340282366920938463463374607431768211456', '-340282366920938463463374607431768211456');
            assert.fail('should overflow');
        } catch {
        }
    });

    it("signed wmul - rounding", async () => {
        assert.equal((await testSignedMath.wmul('1', '499999999999999999')).toString(), '0');
        assert.equal((await testSignedMath.wmul('1', '500000000000000000')).toString(), '1');
        assert.equal((await testSignedMath.wmul('950000000000005647', '1000000000')).toString(), '950000000');
        assert.equal((await testSignedMath.wmul('1000000000', '950000000000005647')).toString(), '950000000');

        assert.equal((await testSignedMath.wmul('-1', '499999999999999999')).toString(), '0');
        assert.equal((await testSignedMath.wmul('-1', '500000000000000000')).toString(), '-1');
        assert.equal((await testSignedMath.wmul('-950000000000005647', '1000000000')).toString(), '-950000000');
        assert.equal((await testSignedMath.wmul('-1000000000', '950000000000005647')).toString(), '-950000000');

        assert.equal((await testSignedMath.wmul('1', '-499999999999999999')).toString(), '0');
        assert.equal((await testSignedMath.wmul('1', '-500000000000000000')).toString(), '-1');
        assert.equal((await testSignedMath.wmul('950000000000005647', '-1000000000')).toString(), '-950000000');
        assert.equal((await testSignedMath.wmul('1000000000', '-950000000000005647')).toString(), '-950000000');

        assert.equal((await testSignedMath.wmul('-1', '-499999999999999999')).toString(), '0');
        assert.equal((await testSignedMath.wmul('-1', '-500000000000000000')).toString(), '1');
        assert.equal((await testSignedMath.wmul('-950000000000005647', '-1000000000')).toString(), '950000000');
        assert.equal((await testSignedMath.wmul('-1000000000', '-950000000000005647')).toString(), '950000000');
    });

    it("signed wdiv - trivial", async () => {
        assert.equal((await testSignedMath.wdiv('0', toWad(1))).toString(), '0');
        assert.equal((await testSignedMath.wdiv(toWad(1), toWad(1))).toString(), toWad(1).toString());
        assert.equal((await testSignedMath.wdiv(toWad(1), toWad(2))).toString(), toWad(0.5).toString());
        assert.equal((await testSignedMath.wdiv(toWad(2), toWad(2))).toString(), toWad(1).toString());

        assert.equal((await testSignedMath.wdiv(toWad(-1), toWad(1))).toString(), toWad(-1).toString());
        assert.equal((await testSignedMath.wdiv(toWad(-1), toWad(2))).toString(), toWad(-0.5).toString());
        assert.equal((await testSignedMath.wdiv(toWad(-2), toWad(2))).toString(), toWad(-1).toString());

        assert.equal((await testSignedMath.wdiv('0', toWad(-1))).toString(), '0');
        assert.equal((await testSignedMath.wdiv(toWad(1), toWad(-1))).toString(), toWad(-1).toString());
        assert.equal((await testSignedMath.wdiv(toWad(1), toWad(-2))).toString(), toWad(-0.5).toString());
        assert.equal((await testSignedMath.wdiv(toWad(2), toWad(-2))).toString(), toWad(-1).toString());

        assert.equal((await testSignedMath.wdiv(toWad(-1), toWad(-1))).toString(), toWad(1).toString());
        assert.equal((await testSignedMath.wdiv(toWad(-1), toWad(-2))).toString(), toWad(0.5).toString());
        assert.equal((await testSignedMath.wdiv(toWad(-2), toWad(-2))).toString(), toWad(1).toString());
    });

    it("signed wdiv - div by 0", async () => {
        try {
            await testSignedMath.wdiv(toWad(1), toWad(0));
            assert.fail('div by 0');
        } catch {
        }
    });

    it("signed wdiv - rounding", async () => {
        assert.equal((await testSignedMath.wdiv('499999999999999999', '1000000000000000000000000000000000000')).toString(), '0');
        assert.equal((await testSignedMath.wdiv('500000000000000000', '1000000000000000000000000000000000000')).toString(), '1');
        assert.equal((await testSignedMath.wdiv(toWad(1), toWad(3))).toString(), '333333333333333333');
        assert.equal((await testSignedMath.wdiv(toWad(2), toWad(3))).toString(), '666666666666666667');
        assert.equal((await testSignedMath.wdiv(toWad(1), 3)).toString(), '333333333333333333333333333333333333');
        assert.equal((await testSignedMath.wdiv(toWad(2), 3)).toString(), '666666666666666666666666666666666667');

        assert.equal((await testSignedMath.wdiv('-499999999999999999', '1000000000000000000000000000000000000')).toString(), '0');
        assert.equal((await testSignedMath.wdiv('-500000000000000000', '1000000000000000000000000000000000000')).toString(), '-1');
        assert.equal((await testSignedMath.wdiv(toWad(-1), toWad(3))).toString(), '-333333333333333333');
        assert.equal((await testSignedMath.wdiv(toWad(-2), toWad(3))).toString(), '-666666666666666667');
        assert.equal((await testSignedMath.wdiv(toWad(-1), 3)).toString(), '-333333333333333333333333333333333333');
        assert.equal((await testSignedMath.wdiv(toWad(-2), 3)).toString(), '-666666666666666666666666666666666667');

        assert.equal((await testSignedMath.wdiv('499999999999999999', '-1000000000000000000000000000000000000')).toString(), '0');
        assert.equal((await testSignedMath.wdiv('500000000000000000', '-1000000000000000000000000000000000000')).toString(), '-1');
        assert.equal((await testSignedMath.wdiv(toWad(1), toWad(-3))).toString(), '-333333333333333333');
        assert.equal((await testSignedMath.wdiv(toWad(2), toWad(-3))).toString(), '-666666666666666667');
        assert.equal((await testSignedMath.wdiv(toWad(1), -3)).toString(), '-333333333333333333333333333333333333');
        assert.equal((await testSignedMath.wdiv(toWad(2), -3)).toString(), '-666666666666666666666666666666666667');

        assert.equal((await testSignedMath.wdiv('-499999999999999999', '-1000000000000000000000000000000000000')).toString(), '0');
        assert.equal((await testSignedMath.wdiv('-500000000000000000', '-1000000000000000000000000000000000000')).toString(), '1');
        assert.equal((await testSignedMath.wdiv(toWad(-1), toWad(-3))).toString(), '333333333333333333');
        assert.equal((await testSignedMath.wdiv(toWad(-2), toWad(-3))).toString(), '666666666666666667');
        assert.equal((await testSignedMath.wdiv(toWad(-1), -3)).toString(), '333333333333333333333333333333333333');
        assert.equal((await testSignedMath.wdiv(toWad(-2), -3)).toString(), '666666666666666666666666666666666667');
    });

    it("power", async () => {
        let i;

        // 0.987... ^ 0 = 1
        i = await testSignedMath.wpowi('987654321012345678', 0);
        err = new BigNumber(i).minus('1000000000000000000').abs();
        assert.ok(err.lt('100'));

        // 0.987... ^ 1 = 0.9
        i = await testSignedMath.wpowi('987654321012345678', 1);
        err = new BigNumber(i).minus('987654321012345678').abs();
        assert.ok(err.lt('100'));

        // 0.987... ^ 2 = 0.9
        i = await testSignedMath.wpowi('987654321012345678', 2);
        err = new BigNumber(i).minus('975461057814357565').abs();
        assert.ok(err.lt('100'));

        // 0.987... ^ 3 = 0.9
        i = await testSignedMath.wpowi('987654321012345678', 3);
        err = new BigNumber(i).minus('963418328729623793').abs();
        assert.ok(err.lt('100'));

        // 0.987... ^ 30 = 0.6
        i = await testSignedMath.wpowi('987654321012345678', 30);
        err = new BigNumber(i).minus('688888672631861173').abs();
        assert.ok(err.lt('100'));

        // 0.987... ^ 31 = 0.6
        i = await testSignedMath.wpowi('987654321012345678', 31);
        err = new BigNumber(i).minus('680383874221316927').abs();
        assert.ok(err.lt('100'));

        // 0.987... ^ 300 = 0.02
        i = await testSignedMath.wpowi('987654321012345678', 300);
        err = new BigNumber(i).minus('24070795168472815').abs();
        assert.ok(err.lt('10000'));

        // 0.987... ^ 301 = 0.02
        i = await testSignedMath.wpowi('987654321012345678', 301);
        err = new BigNumber(i).minus('23773624858345269').abs();
        assert.ok(err.lt('10000'));

        // 0.9999999 ^ 100000 = 0.99
        i = await testSignedMath.wpowi('999999900000000000', 100000);
        err = new BigNumber(i).minus('990049833254143103').abs();
        assert.ok(err.lt('10000'));

        // 0.9999999 ^ 100001 = 0.99
        i = await testSignedMath.wpowi('999999900000000000', 100001);
        err = new BigNumber(i).minus('990049734249159778').abs();
        assert.ok(err.lt('10000'));
    });

    it("log", async () => {
        let i, err;

        // Ln(1.9) = 0.68
        i = await testSignedMath.wln('1975308642024691356');
        err = new BigNumber(i).minus('680724660586388155').abs();
        assert.ok(err.lte('1'));

        // Ln(0.9) = -0.01
        i = await testSignedMath.wln('987654321012345678');
        err = new BigNumber(i).minus('-12422519973557154').abs();
        assert.ok(err.lte('1'));

        // Ln(1) = 0
        i = await testSignedMath.wln('1000000000000000000');
        assert.equal(i.toString(), '0');

        // Ln(1 + 1e-18) = 1e-18
        i = await testSignedMath.wln('1000000000000000001');
        err = new BigNumber(i).minus('1').abs();
        assert.ok(err.lte('1'));

        // Ln(0.1) = -2.3
        i = await testSignedMath.wln('100000000000000000');
        err = new BigNumber(i).minus('-2302585092994045684').abs();
        assert.ok(err.lte('1'));

        // Ln(0.5) = -0.6
        i = await testSignedMath.wln('500000000000000000');
        err = new BigNumber(i).minus('-693147180559945309').abs();
        assert.ok(err.lte('1'));

        // Ln(3) = 1.0
        i = await testSignedMath.wln('3000000000000000000');
        err = new BigNumber(i).minus('1098612288668109691').abs();
        assert.ok(err.lte('1'));

        // Ln(10) = 2.3
        i = await testSignedMath.wln('10000000000000000000');
        err = new BigNumber(i).minus('2302585092994045684').abs();
        assert.ok(err.lte('1'));

        // Ln(1.2345) = 0.2
        i = await testSignedMath.wln('1234500000000000000');
        err = new BigNumber(i).minus('210666029803097142').abs();
        assert.ok(err.lte('1'));

        // Ln(e) = 1
        i = await testSignedMath.wln('2718281828459045235');
        err = new BigNumber(i).minus('1000000000000000000').abs();
        assert.ok(err.lte('1'));

        // Ln(e - 1e-18) = 0.9
        i = await testSignedMath.wln('2718281828459045234');
        err = new BigNumber(i).minus('999999999999999999').abs();
        assert.ok(err.lte('1'));

        // Ln(1e22) = 50.6
        i = await testSignedMath.wln('10000000000000000000000000000000000000000');
        err = new BigNumber(i).minus('50656872045869005048').abs();
        assert.ok(err.lte('1'));

        // Ln(1e22 + 1) = err
        try {
            await testSignedMath.wln('10000000000000000000000000000000000000001');
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("only accepts"), error);
        }
    });

    it("logBase", async () => {
        let i, err;

        // Ln(0.9, 1.9)
        i = await testSignedMath.logBase('900000000000000000', '1900000000000000000');
        err = new BigNumber(i).minus('-6091977456307344157').abs();
        assert.ok(err.lt('100'));

        // Ln(1.9, 0.9)
        i = await testSignedMath.logBase('1900000000000000000', '900000000000000000');
        err = new BigNumber(i).minus('-164150311975407507').abs();
        assert.ok(err.lt('100'));

        // Ln(1.9, 2.9)
        i = await testSignedMath.logBase('1900000000000000000', '2900000000000000000');
        err = new BigNumber(i).minus('1658805469484154444').abs();
        assert.ok(err.lt('100'));
    });

    it("ceil", async () => {
        let i;

        i = await testSignedMath.ceil('0', '1000000000000000000');
        assert.equal(i.toString(), '0');

        i = await testSignedMath.ceil('1', '1000000000000000000');
        assert.equal(i.toString(), '1000000000000000000');

        i = await testSignedMath.ceil('999999999999999999', '1000000000000000000');
        assert.equal(i.toString(), '1000000000000000000');

        i = await testSignedMath.ceil('1000000000000000001', '1000000000000000000');
        assert.equal(i.toString(), '2000000000000000000');

        i = await testSignedMath.ceil('1000000000000000001', '1000000000000000000');
        assert.equal(i.toString(), '2000000000000000000');
    });
});