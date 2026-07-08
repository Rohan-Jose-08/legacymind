import com.sun.source.tree.AssignmentTree;
import com.sun.source.tree.BinaryTree;
import com.sun.source.tree.BlockTree;
import com.sun.source.tree.DoWhileLoopTree;
import com.sun.source.tree.ForLoopTree;
import com.sun.source.tree.WhileLoopTree;
import com.sun.source.tree.ClassTree;
import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.ConditionalExpressionTree;
import com.sun.source.tree.ExpressionStatementTree;
import com.sun.source.tree.ExpressionTree;
import com.sun.source.tree.IdentifierTree;
import com.sun.source.tree.IfTree;
import com.sun.source.tree.LiteralTree;
import com.sun.source.tree.MemberSelectTree;
import com.sun.source.tree.MethodInvocationTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.tree.NewClassTree;
import com.sun.source.tree.ParenthesizedTree;
import com.sun.source.tree.ReturnTree;
import com.sun.source.tree.StatementTree;
import com.sun.source.tree.Tree;
import com.sun.source.tree.VariableTree;
import com.sun.source.util.JavacTask;
import com.sun.source.util.TreeScanner;
import java.io.IOException;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;

/**
 * LegacyMind verifier layer D — modern-side static data-flow extraction.
 *
 * Parses one generated Java source file with the javac Tree API (no
 * compilation, no execution) and emits, as JSON on stdout, the derivation
 * of every KEY=VALUE output the program prints:
 *
 *   inputs      stdin read positions the value transitively derives from
 *   constants   multiplicative numeric constants involved
 *   rounding    "half-up" / "half-even" occurrences (setScale modes)
 *   shifts      decimal-point shifts (movePointLeft / divide by 10^n)
 *   capacities  storage-capacity moduli (remainder arguments)
 *   unresolved  anything the extractor could not analyze — disclosed,
 *               never dropped
 *
 * Deliberately flow-insensitive: assignments in different branches union,
 * matching how the legacy-side extractor treats COBOL IF branches. The
 * comparison itself happens in cli/src/verify/staticflow.ts.
 */
public final class JavaFlow {

    /** An identifier binding: the expression it stands for, resolved in ctx. */
    record Binding(ExpressionTree expr, Map<String, Binding> ctx) { }

    static final class Flow {
        final Set<String> sources = new LinkedHashSet<>();
        final List<String> rounding = new ArrayList<>();
        final Set<String> constants = new LinkedHashSet<>();
        final Set<String> capacities = new LinkedHashSet<>();
        final List<Integer> shifts = new ArrayList<>();
        final Set<Integer> inputs = new LinkedHashSet<>();
        final List<String> unresolved = new ArrayList<>();

        void mergeFrom(Flow other) {
            sources.addAll(other.sources);
            rounding.addAll(other.rounding);
            constants.addAll(other.constants);
            capacities.addAll(other.capacities);
            shifts.addAll(other.shifts);
            inputs.addAll(other.inputs);
            unresolved.addAll(other.unresolved);
        }
    }

    static final class MethodSummary {
        final List<String> params = new ArrayList<>();
        final Map<String, ExpressionTree> locals = new LinkedHashMap<>();
        ExpressionTree returnExpr;
    }

    private static final int MAX_DEPTH = 40;

    private final Map<String, BigDecimal> classConstants = new LinkedHashMap<>();
    private final Map<String, MethodSummary> methods = new LinkedHashMap<>();
    private final Map<String, Flow> varFlows = new LinkedHashMap<>();
    private final Map<String, List<Object>> builderParts = new LinkedHashMap<>();
    private final Map<String, Flow> outputs = new LinkedHashMap<>();
    private final List<String> fileUnresolved = new ArrayList<>();
    private int stdinCounter = 0;

    public static void main(String[] args) throws IOException {
        if (args.length != 1) {
            System.err.println("usage: java JavaFlow <file.java>");
            System.exit(2);
        }
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        try (StandardJavaFileManager fm = compiler.getStandardFileManager(null, null, null)) {
            Iterable<? extends JavaFileObject> units = fm.getJavaFileObjects(args[0]);
            JavacTask task = (JavacTask) compiler.getTask(null, fm, d -> { }, List.of(), null, units);
            JavaFlow flow = new JavaFlow();
            for (CompilationUnitTree unit : task.parse()) {
                for (Tree type : unit.getTypeDecls()) {
                    if (type instanceof ClassTree cls) {
                        flow.analyze(cls);
                    }
                }
            }
            System.out.println(flow.toJson(args[0]));
        }
    }

    private void analyze(ClassTree cls) {
        // Pass 1: class constants and helper-method summaries.
        for (Tree member : cls.getMembers()) {
            if (member instanceof VariableTree field && field.getInitializer() != null) {
                BigDecimal value = evalNumeric(field.getInitializer(), Map.of(), 0);
                if (value != null) classConstants.put(field.getName().toString(), value);
            } else if (member instanceof MethodTree method && !method.getName().contentEquals("main")) {
                MethodSummary summary = new MethodSummary();
                for (VariableTree p : method.getParameters()) summary.params.add(p.getName().toString());
                if (method.getBody() != null) {
                    method.getBody().accept(new TreeScanner<Void, Void>() {
                        @Override
                        public Void visitReturn(ReturnTree node, Void unused) {
                            if (summary.returnExpr == null && node.getExpression() != null
                                    && !isTrivialReturn(node.getExpression())) {
                                summary.returnExpr = node.getExpression();
                            }
                            return super.visitReturn(node, unused);
                        }

                        @Override
                        public Void visitVariable(VariableTree node, Void unused) {
                            if (node.getInitializer() != null) {
                                summary.locals.put(node.getName().toString(), node.getInitializer());
                            }
                            return super.visitVariable(node, unused);
                        }

                    }, null);
                }
                methods.put(method.getName().toString(), summary);
            }
        }
        // Pass 2: walk main in source order.
        for (Tree member : cls.getMembers()) {
            if (member instanceof MethodTree method && method.getName().contentEquals("main") && method.getBody() != null) {
                walkStatements(method.getBody().getStatements());
            }
        }
    }

    /** Error paths return sentinels (BigDecimal.ZERO, ""); the value path is what matters. */
    private static boolean isTrivialReturn(ExpressionTree expr) {
        String s = expr.toString();
        return s.equals("BigDecimal.ZERO") || s.equals("\"\"");
    }

    private void walkStatements(List<? extends StatementTree> statements) {
        for (StatementTree st : statements) {
            if (st instanceof VariableTree decl) {
                Flow flow = decl.getInitializer() == null ? new Flow() : flowOf(decl.getInitializer(), Map.of(), 0);
                merged(decl.getName().toString()).mergeFrom(flow);
                if (isBuilderInit(decl.getInitializer())) builderParts.put(decl.getName().toString(), new ArrayList<>());
            } else if (st instanceof ExpressionStatementTree exprSt) {
                ExpressionTree expr = exprSt.getExpression();
                if (expr instanceof AssignmentTree assign && assign.getVariable() instanceof IdentifierTree id) {
                    merged(id.getName().toString()).mergeFrom(flowOf(assign.getExpression(), Map.of(), 0));
                } else if (expr instanceof MethodInvocationTree call) {
                    handleTopLevelCall(call);
                } else {
                    fileUnresolved.add("statement form not analyzed: " + expr.getKind());
                }
            } else if (st instanceof IfTree ifSt) {
                walkBranch(ifSt.getThenStatement());
                if (ifSt.getElseStatement() != null) walkBranch(ifSt.getElseStatement());
            } else if (st instanceof ForLoopTree loop) {
                // Flow-insensitive union: initializer, body, and update are
                // each walked once — mirroring how the legacy extractor
                // treats PERFORM loop bodies.
                walkStatements(loop.getInitializer());
                walkBranch(loop.getStatement());
                walkStatements(loop.getUpdate());
            } else if (st instanceof WhileLoopTree loop) {
                walkBranch(loop.getStatement());
            } else if (st instanceof DoWhileLoopTree loop) {
                walkBranch(loop.getStatement());
            } else {
                // No hidden failures: an unmodeled statement kind must
                // surface, not silently drop whatever it fed.
                fileUnresolved.add("statement form not analyzed: " + st.getKind());
            }
        }
    }

    private void walkBranch(StatementTree branch) {
        if (branch instanceof BlockTree block) walkStatements(block.getStatements());
        else walkStatements(List.of(branch));
    }

    private Flow merged(String name) {
        return varFlows.computeIfAbsent(name, k -> new Flow());
    }

    // --- output extraction ------------------------------------------------------

    private void handleTopLevelCall(MethodInvocationTree call) {
        String name = methodName(call);
        ExpressionTree receiver = receiverOf(call);
        String base = chainBase(call);
        if (name.equals("append") && base != null && builderParts.containsKey(base)) {
            builderParts.get(base).addAll(flattenAppendChain(call));
            return;
        }
        if ((name.equals("print") || name.equals("println")) && receiver != null
                && receiver.toString().endsWith("System.out")) {
            for (ExpressionTree arg : call.getArguments()) {
                List<Object> parts;
                if (arg instanceof IdentifierTree id && builderParts.containsKey(id.getName().toString())) {
                    parts = builderParts.get(id.getName().toString());
                } else {
                    parts = flattenConcat(arg);
                }
                extractOutputs(parts);
            }
        }
        // System.exit / System.err.println etc. — no data flow to outputs.
    }

    private void extractOutputs(List<Object> parts) {
        String pendingKey = null;
        for (Object part : parts) {
            if (part instanceof String s) {
                java.util.regex.Matcher m = java.util.regex.Pattern.compile("([A-Z][A-Z0-9_]*)=\\s*$").matcher(s);
                pendingKey = m.find() ? m.group(1) : null;
            } else if (part instanceof ExpressionTree expr) {
                if (pendingKey != null) {
                    outputs.computeIfAbsent(pendingKey, k -> new Flow()).mergeFrom(flowOf(expr, Map.of(), 0));
                    pendingKey = null;
                }
            }
        }
    }

    private List<Object> flattenConcat(ExpressionTree expr) {
        List<Object> out = new ArrayList<>();
        if (expr instanceof BinaryTree bin && bin.getKind() == Tree.Kind.PLUS) {
            out.addAll(flattenConcat(bin.getLeftOperand()));
            out.addAll(flattenConcat(bin.getRightOperand()));
        } else if (expr instanceof LiteralTree lit) {
            if (lit.getValue() instanceof String s) out.add(s);
            // char separators like '\n' carry no key information
        } else if (expr instanceof ParenthesizedTree p) {
            out.addAll(flattenConcat(p.getExpression()));
        } else {
            out.add(expr);
        }
        return out;
    }

    private List<Object> flattenAppendChain(MethodInvocationTree call) {
        List<Object> out = new ArrayList<>();
        ExpressionTree receiver = receiverOf(call);
        if (receiver instanceof MethodInvocationTree inner && methodName(inner).equals("append")) {
            out.addAll(flattenAppendChain(inner));
        }
        for (ExpressionTree arg : call.getArguments()) {
            if (arg instanceof LiteralTree lit) {
                if (lit.getValue() instanceof String s) out.add(s);
            } else {
                out.add(arg);
            }
        }
        return out;
    }

    private String chainBase(MethodInvocationTree call) {
        ExpressionTree receiver = receiverOf(call);
        if (receiver instanceof IdentifierTree id) return id.getName().toString();
        if (receiver instanceof MethodInvocationTree inner) return chainBase(inner);
        return null;
    }

    private boolean isBuilderInit(ExpressionTree init) {
        return init instanceof NewClassTree n && n.getIdentifier().toString().contains("StringBuilder");
    }

    // --- flow extraction ----------------------------------------------------------

    private Flow flowOf(ExpressionTree expr, Map<String, Binding> bindings, int depth) {
        Flow flow = new Flow();
        if (expr == null) return flow;
        if (depth > MAX_DEPTH) {
            flow.unresolved.add("resolution depth limit reached");
            return flow;
        }
        switch (expr) {
            case ParenthesizedTree p -> flow.mergeFrom(flowOf(p.getExpression(), bindings, depth + 1));
            case LiteralTree lit -> {
                BigDecimal v = numericLiteral(lit);
                if (v != null) flow.constants.add(canon(v));
            }
            case IdentifierTree id -> {
                String name = id.getName().toString();
                Binding b = bindings.get(name);
                if (b != null) {
                    flow.mergeFrom(flowOf(b.expr(), b.ctx(), depth + 1));
                } else if (classConstants.containsKey(name)) {
                    flow.constants.add(canon(classConstants.get(name)));
                } else {
                    flow.sources.add(name);
                }
            }
            case ConditionalExpressionTree cond -> {
                // condition guards which branch runs; the value derives from the branches
                flow.mergeFrom(flowOf(cond.getTrueExpression(), bindings, depth + 1));
                flow.mergeFrom(flowOf(cond.getFalseExpression(), bindings, depth + 1));
            }
            case BinaryTree bin -> {
                flow.mergeFrom(flowOf(bin.getLeftOperand(), bindings, depth + 1));
                flow.mergeFrom(flowOf(bin.getRightOperand(), bindings, depth + 1));
            }
            case NewClassTree n -> {
                BigDecimal v = evalNumeric(n, bindings, depth + 1);
                if (v != null) flow.constants.add(canon(v));
                else for (ExpressionTree arg : n.getArguments()) flow.mergeFrom(flowOf(arg, bindings, depth + 1));
            }
            case MethodInvocationTree call -> flowOfCall(call, bindings, flow, depth);
            case MemberSelectTree sel -> {
                // BigDecimal.ZERO is the initialization sentinel (mirrors a
                // COBOL VALUE ZERO initializer): it contributes no flow.
                if (!isTrivialReturn(sel)) {
                    flow.unresolved.add("expression form not analyzed: " + expr.getKind());
                }
            }
            default -> flow.unresolved.add("expression form not analyzed: " + expr.getKind());
        }
        return flow;
    }

    private void flowOfCall(MethodInvocationTree call, Map<String, Binding> bindings, Flow flow, int depth) {
        String name = methodName(call);
        ExpressionTree receiver = receiverOf(call);
        switch (name) {
            case "setScale" -> {
                flow.mergeFrom(flowOf(receiver, bindings, depth + 1));
                String mode = call.getArguments().size() > 1 ? lastName(call.getArguments().get(1)) : "";
                switch (mode) {
                    case "HALF_UP" -> flow.rounding.add("half-up");
                    case "HALF_EVEN" -> flow.rounding.add("half-even");
                    case "DOWN", "FLOOR" -> { /* truncation: not compared (often a numeric no-op) */ }
                    default -> flow.unresolved.add("unrecognized rounding mode: " + mode);
                }
            }
            case "remainder" -> {
                flow.mergeFrom(flowOf(receiver, bindings, depth + 1));
                BigDecimal cap = evalNumeric(call.getArguments().get(0), bindings, depth + 1);
                if (cap != null) flow.capacities.add(canon(cap));
                else flow.unresolved.add("remainder argument not statically resolvable");
            }
            case "movePointLeft" -> {
                flow.mergeFrom(flowOf(receiver, bindings, depth + 1));
                BigDecimal n = evalNumeric(call.getArguments().get(0), bindings, depth + 1);
                if (n != null) flow.shifts.add(n.intValue());
                else flow.unresolved.add("movePointLeft argument not statically resolvable");
            }
            case "divide" -> {
                flow.mergeFrom(flowOf(receiver, bindings, depth + 1));
                BigDecimal d = evalNumeric(call.getArguments().get(0), bindings, depth + 1);
                Integer p = d == null ? null : powerOfTen(d);
                if (p != null) flow.shifts.add(p);
                else if (d != null) flow.constants.add(canon(d));
                else flow.unresolved.add("divide argument not statically resolvable");
            }
            case "multiply", "add", "subtract" -> {
                flow.mergeFrom(flowOf(receiver, bindings, depth + 1));
                for (ExpressionTree arg : call.getArguments()) flow.mergeFrom(flowOf(arg, bindings, depth + 1));
            }
            case "toPlainString", "trim", "stripTrailingZeros" ->
                flow.mergeFrom(flowOf(receiver, bindings, depth + 1));
            case "readLine" -> flow.inputs.add(stdinCounter++);
            default -> {
                MethodSummary summary = methods.get(name);
                if (summary != null) {
                    // stdin positions are counted where the readLine call is
                    // reached during body resolution — never pre-counted here,
                    // or wrapper helpers would double-count each read.
                    // Bind params to call-site args (resolved in the caller's
                    // context) and locals to their initializers (resolved in
                    // the method's own context — the map references itself).
                    Map<String, Binding> inner = new LinkedHashMap<>();
                    for (int i = 0; i < summary.params.size() && i < call.getArguments().size(); i++) {
                        inner.put(summary.params.get(i), new Binding(call.getArguments().get(i), bindings));
                    }
                    for (Map.Entry<String, ExpressionTree> local : summary.locals.entrySet()) {
                        inner.put(local.getKey(), new Binding(local.getValue(), inner));
                    }
                    if (summary.returnExpr != null) flow.mergeFrom(flowOf(summary.returnExpr, inner, depth + 1));
                } else if (name.equals("compareTo") || name.equals("signum")) {
                    // comparisons guard control flow; they are not value derivations
                } else {
                    flow.unresolved.add("call not analyzed: " + name);
                }
            }
        }
    }

    // --- numeric evaluation ---------------------------------------------------------

    private BigDecimal evalNumeric(ExpressionTree expr, Map<String, Binding> bindings, int depth) {
        if (expr == null || depth > MAX_DEPTH) return null;
        if (expr instanceof ParenthesizedTree p) return evalNumeric(p.getExpression(), bindings, depth + 1);
        if (expr instanceof LiteralTree lit) return numericLiteral(lit);
        if (expr instanceof IdentifierTree id) {
            String name = id.getName().toString();
            Binding b = bindings.get(name);
            if (b != null) return evalNumeric(b.expr(), b.ctx(), depth + 1);
            return classConstants.get(name);
        }
        if (expr instanceof NewClassTree n && n.getIdentifier().toString().contains("BigDecimal")
                && n.getArguments().size() == 1) {
            ExpressionTree arg = n.getArguments().get(0);
            if (arg instanceof LiteralTree lit && lit.getValue() instanceof String s) {
                try {
                    return new BigDecimal(s);
                } catch (NumberFormatException e) {
                    return null;
                }
            }
            return evalNumeric(arg, bindings, depth + 1);
        }
        if (expr instanceof MethodInvocationTree call && methodName(call).equals("pow")) {
            ExpressionTree receiver = receiverOf(call);
            if (receiver != null && receiver.toString().endsWith("TEN")) {
                BigDecimal exp = evalNumeric(call.getArguments().get(0), bindings, depth + 1);
                if (exp != null) return BigDecimal.TEN.pow(exp.intValue());
            }
        }
        return null;
    }

    private static BigDecimal numericLiteral(LiteralTree lit) {
        Object v = lit.getValue();
        if (v instanceof Integer i) return BigDecimal.valueOf(i);
        if (v instanceof Long l) return BigDecimal.valueOf(l);
        if (v instanceof Double d) return BigDecimal.valueOf(d);
        if (v instanceof String s) {
            try {
                return new BigDecimal(s);
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }

    private static Integer powerOfTen(BigDecimal v) {
        BigDecimal x = v.stripTrailingZeros();
        for (int p = 0; p <= 18; p++) {
            if (x.compareTo(BigDecimal.TEN.pow(p)) == 0) return p;
        }
        return null;
    }

    private static String canon(BigDecimal v) {
        return v.stripTrailingZeros().toPlainString();
    }

    private static String methodName(MethodInvocationTree call) {
        ExpressionTree select = call.getMethodSelect();
        if (select instanceof MemberSelectTree m) return m.getIdentifier().toString();
        if (select instanceof IdentifierTree id) return id.getName().toString();
        return "";
    }

    private static ExpressionTree receiverOf(MethodInvocationTree call) {
        return call.getMethodSelect() instanceof MemberSelectTree m ? m.getExpression() : null;
    }

    private static String lastName(ExpressionTree expr) {
        if (expr instanceof MemberSelectTree m) return m.getIdentifier().toString();
        if (expr instanceof IdentifierTree id) return id.getName().toString();
        return expr.toString();
    }

    // --- transitive resolution + JSON --------------------------------------------------

    private Flow resolve(Flow flow, Set<String> visited) {
        Flow out = new Flow();
        out.rounding.addAll(flow.rounding);
        out.constants.addAll(flow.constants);
        out.capacities.addAll(flow.capacities);
        out.shifts.addAll(flow.shifts);
        out.inputs.addAll(flow.inputs);
        out.unresolved.addAll(flow.unresolved);
        for (String src : flow.sources) {
            if (!visited.add(src)) continue; // self-reassignment: already accumulated
            Flow def = varFlows.get(src);
            if (def != null) out.mergeFrom(resolve(def, visited));
            else out.unresolved.add("source not defined in main: " + src);
        }
        return out;
    }

    private String toJson(String file) {
        StringBuilder sb = new StringBuilder();
        sb.append("{\"tool\":\"legacymind javaflow\",\"file\":").append(quote(file)).append(",\"outputs\":{");
        boolean first = true;
        for (Map.Entry<String, Flow> e : outputs.entrySet()) {
            Flow r = resolve(e.getValue(), new LinkedHashSet<>());
            r.unresolved.addAll(fileUnresolved);
            if (!first) sb.append(',');
            first = false;
            sb.append(quote(e.getKey())).append(":{");
            sb.append("\"inputs\":").append(r.inputs.toString());
            sb.append(",\"constants\":").append(quoteAll(r.constants));
            sb.append(",\"rounding\":").append(quoteAll(r.rounding));
            sb.append(",\"shifts\":").append(r.shifts.toString());
            sb.append(",\"capacities\":").append(quoteAll(r.capacities));
            sb.append(",\"unresolved\":").append(quoteAll(r.unresolved));
            sb.append('}');
        }
        sb.append("}}");
        return sb.toString();
    }

    private static String quote(String s) {
        return '"' + s.replace("\\", "\\\\").replace("\"", "\\\"") + '"';
    }

    private static String quoteAll(Iterable<String> items) {
        StringBuilder sb = new StringBuilder("[");
        boolean first = true;
        for (String s : items) {
            if (!first) sb.append(',');
            first = false;
            sb.append(quote(s));
        }
        return sb.append(']').toString();
    }
}
