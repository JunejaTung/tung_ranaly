var moment = require('moment');

var ZMINSCORE = ' \
local result = {} \
local length = #ARGV \
local step   = ARGV[1] \
  for i = 2, length, step do \
    local score = 0 \
    for j = 0, step-1 do \
      local sctmp = redis.call("zscore", KEYS[1], ARGV[i+j]) \
      if not sctmp then \
        sctmp = 0 \
      else \
        sctmp = tonumber(sctmp) \
      end \
      score = score + sctmp \
    end \
    result[(i-2)/step+1] = score \
  end \
  return result \
';

var ZMSCORE = ' \
local result = {} \
local length = #ARGV \
for i = 1, length do \
  local score = 0 \
  if #ARGV[i] == 8 then \
    for j = 0, 23 do \
      local k = tostring(j) \
      if #k == 1 then \
        k = "0" .. k \
      end \
      local r = redis.call("zscore", KEYS[1], ARGV[i] .. k) \
      if r then \
        score = score + r \
      end \
    end \
  else \
    score = redis.call("zscore", KEYS[1], ARGV[i]) \
    if not score then \
      score = 0 \
    else \
      score = tonumber(score) \
    end \
  end \
  result[i] = score \
end \
return result \
';

var ZSUMSCORE = ' \
local length = #ARGV \
local score = 0 \
if #ARGV >= 1 then \
  for i = 1, length do \
    if #ARGV[i] == 8 then \
      for j = 0, 23 do \
        local k = tostring(j) \
        if #k == 1 then \
          k = "0" .. k \
        end \
        local result = redis.call("zscore", KEYS[1], ARGV[i] .. k) \
        if result then \
          score = score + result \
        end \
      end \
    else \
      local result = redis.call("zscore", KEYS[1], ARGV[i]) \
      if result then \
        score = score + result \
      end \
    end \
  end \
else \
  local result = redis.call("get", KEYS[1] .. ":TOTAL") \
  if result then \
    score = tonumber(result) \
  end \
end \
return score \
';
var ZMINSUMSCORE = ' \
local sum = 0 \
local length = #ARGV \
local step   = ARGV[1] \
  for i = 2, length, step do \
    local score = 0 \
    for j = 0, step-1 do \
      local sctmp = redis.call("zscore", KEYS[1], ARGV[i+j]) \
      if not sctmp then \
        sctmp = 0 \
      else \
        sctmp = tonumber(sctmp) \
      end \
      score = score + sctmp \
    end \
    sum = sum + score \
  end \
  return sum \
';

module.exports = function (ranaly) {
  var db = ranaly.redisClient;

  var Amount = function (bucket) {
    this.bucket = bucket;
    this.key = ranaly.prefix + 'AMOUNT' + ':' + this.bucket;
    this.mkey = ranaly.prefix + 'MINUTE' + ':' + this.bucket;
  };

  Amount.prototype.incr = function (increment, when, callback) {
    if (typeof increment === 'function') {
      callback = increment;
      increment = void 0;
    } else if (typeof when === 'function') {
      callback = when;
      when = void 0;
    }
    if (typeof increment !== 'number') {
      increment = 1;
    }
    when = moment(when);
    db.multi()
      .incrby(this.key + ':TOTAL', increment)
      .zincrby(this.key, increment,when.format('YYYYMMDDHH'))
      .zincrby(this.mkey, increment,when.format('YYYYMMDDHHmm'))
      .exec(function (err, result) {
        if (typeof callback === 'function') {
          callback(err, Array.isArray(result) ? result[0] : result);
        }
      });
  };

  Amount.prototype.decr = function (decrement, when, callback) {
    if (typeof decrement === 'function') {
      callback = decrement;
      decrement = void 0;
    } else if (typeof when === 'function') {
      callback = when;
      when = void 0;
    }
    if (typeof decrement !== 'number') {
      decrement = 1;
    }
    when = moment(when);
    db.multi()
      .decrby(this.key + ':TOTAL', decrement)
      .zincrby(this.key, -decrement, when.format('YYYYMMDDHH'))
      .zincrby(this.mkey, -decrement, when.format('YYYYMMDDHHmm'))
      .exec(function (err, result) {
        if (typeof callback === 'function') {
          callback(err, Array.isArray(result) ? result[0] : result);
        }
      });
  };

  Amount.prototype.get = function (timeList, callback) {
    var next = function (err, result) {
      callback(err, result);
    };

    if (timeList[1].length == 12 ) {
      var step = timeList[1].substring(10)-timeList[0].substring(10);
      step = (step < 0) ? step + 60 : step;
      var spreadList = this._spreadTimeList(timeList, step);
      db['eval'].apply(db, [ZMINSCORE].concat(1).concat(this.mkey).concat(step).concat(spreadList).concat(next));
    }else{
      db['eval'].apply(db, [ZMSCORE].concat(1).concat(this.key).concat(timeList).concat(next));
    }
  };

  Amount.prototype.sum = function (timeList, callback) {
    var next = function (err, result) {
      callback(err, result);
    };

    var tl = [ZSUMSCORE].concat(1).concat(this.key);
    if (Array.isArray(timeList) && timeList.length > 0) {
      if (timeList[1].length == 12) {
        var num = timeList[1].substring(10)-timeList[0].substring(10);
        num = (num < 0) ? num+60 : num;
        var spreadList = this._spreadTimeList(timeList, num);
        tl = [ZMINSUMSCORE].concat(1).concat(this.mkey).concat(num).concat(spreadList).concat(next);
      } else {
        tl = tl.concat(timeList).concat(next);
      }
    } else {
      tl = tl.concat(next);
    }
    db['eval'].apply(db, tl);
  };

  Amount.prototype.set = function (total, callback) {
    var chgNum = 0;
    var _this  = this;

    db.get(this.key + ':TOTAL', function (err, resSum) {
      if (resSum !== null) {
        chgNum = total - resSum;

        Amount.prototype.incr.call(_this, chgNum, callback);
      } else {
        Amount.prototype.incr.call(_this, total, callback);
      }
    });
  };

  // 带时间戳的总数值
  Amount.prototype.setGross = function (value, when, callback) {
    if (typeof when === 'function') {
      callback = when;
      when = void 0;
    }
    when = moment(when);
    db.multi()
      .zadd(this.key + ':GROSS', value, when.format('YYYYMMDDHH'))
      .zadd(this.mkey + ':GROSS', value, when.format('YYYYMMDDHHmm'))
      .exec(function (err, result) {
        if (typeof callback === 'function') {
          callback(err, Array.isArray(result) ? result[0] : result);
        }
      });
  };

  Amount.prototype.getGross = function (timeList, callback) {
    var next = function (err, result) {
      callback(err, result);
    };
    var slen = timeList[1].length;

    switch (slen) {
      case 12: {
        var step = timeList[1].substring(10)-timeList[0].substring(10);
        step = (step < 0) ? step + 60 : step;
        var spreadList = this._spreadTimeList(timeList, step);

        db['eval'].apply(db, [ZMINSCORE].concat(1).concat(this.mkey + ':GROSS').concat(step).concat(spreadList).concat(next));
        break;
      }
      case 10: {
        db['eval'].apply(db, [ZMSCORE].concat(1).concat(this.key + ':GROSS').concat(timeList).concat(next));
        break;
      }
      case 8: {
        var tmpList = [];
        var tlen    = timeList.length;
        var i = 0;

        for (; i < tlen-1; i++) {
          tmpList.push(timeList[i] + '23');
        }
        tmpList.push(timeList[i] + moment().format('HH'));
        db['eval'].apply(db, [ZMSCORE].concat(1).concat(this.key + ':GROSS').concat(tmpList).concat(next));
        break;
      }
      default : {
        console.error('[RANALY]Invalid timestamps: ' + timeList[0]);
      }
    }
  };

  /**
   * 分钟级别时间戳数组展开：
   * 每时间点按步长step向前展开成一分钟步长的数组
   * 注意：1、timeList时间戳为分钟级别
   *      2、timeList元素前后时间点的步长固定相等为step
   * */
  Amount.prototype._spreadTimeList = function (timeList, step) {
    var len  = timeList.length;

    if (1 == step) {
      return timeList;
    }

    var newList = [];
    var tmpwhen = '';
    var s = 0;
    for (var i = 0; i < len; i++) {
      tmpwhen = moment(timeList[i], 'YYYYMMDDHHmm');

      var tmpspd  = [];
      tmpspd[step-1] = timeList[i];
      for (s = step-2; s >= 0; s--) {
        tmpspd[s] = tmpwhen.subtract(1, 'minutes').format('YYYYMMDDHHmm');
      }
      newList[i] = tmpspd;
    }

    return newList;
  };

  return Amount;
};

