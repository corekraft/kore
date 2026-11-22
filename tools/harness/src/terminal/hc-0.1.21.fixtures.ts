// hc 0.1.21's replies to each Terminals method, recorded from a real core
// (plan 16, Step 2) on 2026-11-22. `hc --version` printed "hc 0.1.21". Each
// reply is hc's own --json output, byte for byte, from a scratch HC_SESSION
// (kore-record) with its XDG dirs under a temp dir, so the cwd is that temp dir.
// The names carry the version: a new hc means a new set, recorded again.

export const RECORDED_CWD = "/tmp/kore-rec-sIzhnv/work";

export const HC_0_1_21 = {
  version: "hc 0.1.21",
  run: '{"address":"t1","agent":"sh","cwd":"/tmp/kore-rec-sIzhnv/work","name":"p","state":"live","turn":0}',
  runChild:
    '{"address":"t2","agent":"sh","cwd":"/tmp/kore-rec-sIzhnv/work","name":"s1","parent":"t1","state":"live","turn":0}',
  runLiveChild:
    '{"address":"t5","agent":"sh","cwd":"/tmp/kore-rec-sIzhnv/work","name":"s4","parent":"t1","state":"live","turn":0}',
  get: '{"address":"t2","argv":["sh"],"cols":200,"created_ms":1795349489426,"cwd":"/tmp/kore-rec-sIzhnv/work","die_with_parent":true,"exit_code":null,"finished_ms":null,"foreground":{"argv":["sh"],"cwd":"/tmp/kore-rec-sIzhnv/work","name":"sh","pid":4041572},"identity":"ghostty","keep":false,"labels":{"kore-session":"s1","role":"writer"},"name":"s1","notify":true,"parent":"t1","pid":4041572,"reason":null,"reported":false,"rm":false,"rows":120,"screen":"exact","signal":null,"state":"live","status":null,"status_ms":null,"template":null,"title":"","turn":0}',
  getFinished:
    '{"address":"t2","argv":["sh"],"cols":200,"created_ms":1795349489426,"cwd":"/tmp/kore-rec-sIzhnv/work","die_with_parent":true,"exit_code":0,"finished_ms":1795349500230,"identity":"ghostty","keep":false,"labels":{"kore-session":"s1","model":"sonnet","role":"writer"},"name":"s1","notify":true,"parent":"t1","pid":4041572,"reason":"exited","reported":false,"rm":false,"rows":120,"screen":"exact","signal":null,"state":"finished","status":null,"status_ms":null,"template":null,"title":"","turn":0}',
  getParentLive:
    '{"address":"t1","argv":["sh"],"cols":200,"created_ms":1795349487626,"cwd":"/tmp/kore-rec-sIzhnv/work","die_with_parent":false,"exit_code":null,"finished_ms":null,"foreground":{"argv":["sh"],"cwd":"/tmp/kore-rec-sIzhnv/work","name":"sh","pid":4041430},"identity":"ghostty","keep":false,"labels":{},"name":"p","notify":true,"parent":null,"pid":4041430,"reason":null,"reported":false,"rm":false,"rows":120,"screen":"exact","signal":null,"state":"live","status":null,"status_ms":null,"template":null,"title":"","turn":0}',
  getParentFinished:
    '{"address":"t1","argv":["sh"],"cols":200,"created_ms":1795349487626,"cwd":"/tmp/kore-rec-sIzhnv/work","die_with_parent":false,"exit_code":null,"finished_ms":1795349616980,"identity":"ghostty","keep":false,"labels":{},"name":"p","notify":true,"parent":null,"pid":4041430,"reason":"killed","reported":false,"rm":false,"rows":120,"screen":"exact","signal":1,"state":"finished","status":null,"status_ms":null,"template":null,"title":"","turn":0}',
  getLiveChild:
    '{"address":"t5","argv":["sh"],"cols":200,"created_ms":1795349613431,"cwd":"/tmp/kore-rec-sIzhnv/work","die_with_parent":true,"exit_code":null,"finished_ms":null,"foreground":{"argv":["sh"],"cwd":"/tmp/kore-rec-sIzhnv/work","name":"sh","pid":4056432},"identity":"ghostty","keep":false,"labels":{},"name":"s4","notify":true,"parent":"t1","pid":4056432,"reason":null,"reported":false,"rm":false,"rows":120,"screen":"exact","signal":null,"state":"live","status":null,"status_ms":null,"template":null,"title":"","turn":0}',
  getSibling:
    '{"address":"t3","argv":["sh"],"cols":200,"created_ms":1795349490703,"cwd":"/tmp/kore-rec-sIzhnv/work","die_with_parent":true,"exit_code":2,"finished_ms":1795349503167,"identity":"ghostty","keep":false,"labels":{"kore-session":"s2","role":"writer"},"name":"s2","notify":true,"parent":"t1","pid":4041631,"reason":"exited","reported":false,"rm":false,"rows":120,"screen":"exact","signal":null,"state":"finished","status":null,"status_ms":null,"template":null,"title":"","turn":0}',
  listLate:
    '{"hidden_finished":0,"terminals":[{"address":"t1","agent":"sh","cwd":"/tmp/kore-rec-sIzhnv/work","name":"p","reason":"killed","signal":1,"state":"finished","turn":0},{"address":"t2","agent":"sh","cwd":"/tmp/kore-rec-sIzhnv/work","exit_code":0,"name":"s1","parent":"t1","reason":"exited","state":"finished","turn":0},{"address":"t3","agent":"sh","cwd":"/tmp/kore-rec-sIzhnv/work","exit_code":2,"name":"s2","parent":"t1","reason":"exited","state":"finished","turn":0},{"address":"t5","agent":"sh","cwd":"/tmp/kore-rec-sIzhnv/work","name":"s4","parent":"t1","reason":"killed","signal":1,"state":"finished","turn":0}]}',
  getKilledChild:
    '{"address":"t5","argv":["sh"],"cols":200,"created_ms":1795349613431,"cwd":"/tmp/kore-rec-sIzhnv/work","die_with_parent":true,"exit_code":null,"finished_ms":1795349616983,"identity":"ghostty","keep":false,"labels":{},"name":"s4","notify":true,"parent":"t1","pid":4056432,"reason":"killed","reported":false,"rm":false,"rows":120,"screen":"exact","signal":1,"state":"finished","status":null,"status_ms":null,"template":null,"title":"","turn":0}',
  list: '{"hidden_finished":0,"terminals":[{"address":"t1","agent":"sh","cwd":"/tmp/kore-rec-sIzhnv/work","name":"p","state":"live","turn":0},{"address":"t2","agent":"sh","cwd":"/tmp/kore-rec-sIzhnv/work","name":"s1","parent":"t1","state":"live","turn":0},{"address":"t3","agent":"sh","cwd":"/tmp/kore-rec-sIzhnv/work","name":"s2","parent":"t1","state":"live","turn":0},{"address":"t4","agent":"sh","cwd":"/tmp/kore-rec-sIzhnv/work","name":"s3","parent":"t1","state":"live","turn":0}]}',
  listLabel:
    '{"hidden_finished":0,"terminals":[{"address":"t2","agent":"sh","cwd":"/tmp/kore-rec-sIzhnv/work","name":"s1","parent":"t1","state":"live","turn":0},{"address":"t3","agent":"sh","cwd":"/tmp/kore-rec-sIzhnv/work","name":"s2","parent":"t1","state":"live","turn":0}]}',
  read: '{"complete":true,"how":"history","text":"$ printf \'%b\' \'one\\\\ntwo\\\\nthree\\\\n\'\\none\\ntwo\\nthree\\n$"}',
  send: '{"started":null,"status":null,"turn":0}',
  label:
    '{"address":"t2","argv":["sh"],"cols":200,"created_ms":1795349489426,"cwd":"/tmp/kore-rec-sIzhnv/work","die_with_parent":true,"exit_code":null,"finished_ms":null,"foreground":{"argv":["sh"],"cwd":"/tmp/kore-rec-sIzhnv/work","name":"sh","pid":4041572},"identity":"ghostty","keep":false,"labels":{"kore-session":"s1","model":"sonnet","role":"writer"},"name":"s1","notify":true,"parent":"t1","pid":4041572,"reason":null,"reported":false,"rm":false,"rows":120,"screen":"exact","signal":null,"state":"live","status":null,"status_ms":null,"template":null,"title":"","turn":0}',
  waitTimeout:
    '{"children":[],"ended":false,"exit_code":null,"reason":"timeout","signal":null,"status":null,"terminal":"t2","turn":0}',
  waitTerminal:
    '{"children":[],"ended":true,"exit_code":0,"reason":"exit","signal":null,"status":null,"terminal":"t2","turn":0}',
  waitChildrenAny:
    '{"children":[{"children":[],"ended":true,"exit_code":2,"reason":"exit","signal":null,"status":null,"terminal":"t3","turn":0}],"ended":true,"exit_code":null,"reason":"children","signal":null,"status":null,"terminal":"t1","turn":0}',
  waitChildrenAll:
    '{"children":[{"children":[],"ended":false,"exit_code":null,"reason":"running","signal":null,"status":null,"terminal":"t4","turn":0}],"ended":false,"exit_code":null,"reason":"timeout","signal":null,"status":null,"terminal":"t1","turn":0}',
  interrupt: '{"key":"ctrl+c","outcome":"unknown"}',
  kill: '{"address":"t4","argv":["sh"],"cols":200,"created_ms":1795349491719,"cwd":"/tmp/kore-rec-sIzhnv/work","die_with_parent":true,"exit_code":null,"finished_ms":1795349518875,"identity":"ghostty","keep":false,"labels":{},"name":"s3","notify":true,"parent":"t1","pid":4041696,"reason":"killed","reported":false,"rm":false,"rows":120,"screen":"exact","signal":1,"state":"finished","status":null,"status_ms":null,"template":null,"title":"","turn":0}',
  remove: '{"removed":"t4"}',
  errors: {
    notFound:
      '{"error":{"hint":"see `hc ls --all`","kind":"not_found","message":"no terminal \\"nope\\""}}',
    nameTaken:
      '{"error":{"hint":"pick another name, or kill the one holding it","kind":"name_taken","message":"a live terminal is already named \\"s3\\""}}',
    live: '{"error":{"hint":"kill it first: hc kill t4","kind":"live","message":"t4 is still running"}}',
    finished:
      '{"error":{"hint":"hc read t3","kind":"finished","message":"t3 has finished"}}',
    needsTarget:
      '{"error":{"hint":"run it inside a terminal, or name the parent","kind":"needs_target","message":"whose children?"}}',
  },
};
