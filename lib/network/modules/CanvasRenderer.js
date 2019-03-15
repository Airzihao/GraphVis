/**
 * Initializes window.requestAnimationFrame() to a usable form.
 *
 * Specifically, set up this method for the case of running on node.js with jsdom enabled.
 *
 * NOTES:
 *
 * * On node.js, when calling this directly outside of this class, `window` is not defined.
 *   This happens even if jsdom is used.
 * * For node.js + jsdom, `window` is available at the moment the constructor is called.
 *   For this reason, the called is placed within the constructor.
 * * Even then, `window.requestAnimationFrame()` is not defined, so it still needs to be added.
 * * During unit testing, it happens that the window object is reset during execution, causing
 *   a runtime error due to missing `requestAnimationFrame()`. This needs to be compensated for,
 *   see `_requestNextFrame()`.
 * * Since this is a global object, it may affect other modules besides `Network`. With normal
 *   usage, this does not cause any problems. During unit testing, errors may occur. These have
 *   been compensated for, see comment block in _requestNextFrame().
 *
 * @private
 */
function _initRequestAnimationFrame() {
  var func;

  if (window !== undefined) {
    func = window.requestAnimationFrame
        || window.mozRequestAnimationFrame
        || window.webkitRequestAnimationFrame
        || window.msRequestAnimationFrame;
  }

  if (func === undefined) {
    // window or method not present, setting mock requestAnimationFrame
    window.requestAnimationFrame =
     function(callback) {
       //console.log("Called mock requestAnimationFrame");
       callback();
     }
  } else {
     window.requestAnimationFrame = func;
  }
}

let util = require('../../util');

/**
 * The canvas renderer
 */
class CanvasRenderer {
  /**
   * @param {Object} body
   * @param {Canvas} canvas
   * @param {Object} groups
   */
  constructor(body, canvas, groups) {
    _initRequestAnimationFrame();
    this.body = body;
    this.canvas = canvas;
    this.groups = groups;

    this.redrawRequested = false;
    this.renderTimer = undefined;
    this.requiresTimeout = true;
    this.renderingActive = false;
    this.renderRequests = 0;
    this.allowRedraw = true;

    this.dragging = false;
    this.options = {};
    this.defaultOptions = {
      hideEdgesOnDrag: false,
      hideNodesOnDrag: false
    };
    util.extend(this.options, this.defaultOptions);

    this._determineBrowserMethod();
    this.bindEventListeners();
  }

  /**
   * Binds event listeners
   */
  bindEventListeners() {
    this.body.emitter.on("dragStart", () => { this.dragging = true; });
    this.body.emitter.on("dragEnd", () => { this.dragging = false; });
    this.body.emitter.on("_resizeNodes", () => { this._resizeNodes(); });
    this.body.emitter.on("_redraw", () => {
      if (this.renderingActive === false) {
        this._redraw();
      }
    });
    this.body.emitter.on("_blockRedraw", () => {this.allowRedraw = false;});
    this.body.emitter.on("_allowRedraw", () => {this.allowRedraw = true; this.redrawRequested = false;});
    this.body.emitter.on("_requestRedraw", this._requestRedraw.bind(this));
    this.body.emitter.on("_startRendering", () => {
      this.renderRequests += 1;
      this.renderingActive = true;
      this._startRendering();
    });
    this.body.emitter.on("_stopRendering", () => {
      this.renderRequests -= 1;
      this.renderingActive = this.renderRequests > 0;
      this.renderTimer = undefined;
    });
    this.body.emitter.on('destroy',  () => {
      this.renderRequests = 0;
      this.allowRedraw = false;
      this.renderingActive = false;
      if (this.requiresTimeout === true) {
        clearTimeout(this.renderTimer);
      }
      else {
        window.cancelAnimationFrame(this.renderTimer);
      }
      this.body.emitter.off();
    });

  }

  /**
   *
   * @param {Object} options
   */
  setOptions(options) {
    if (options !== undefined) {
      let fields = ['hideEdgesOnDrag','hideNodesOnDrag'];
      util.selectiveDeepExtend(fields,this.options, options);
    }
  }


  /**
   * Prepare the drawing of the next frame.
   *
   * Calls the callback when the next frame can or will be drawn.
   *
   * @param {function} callback
   * @param {number} delay - timeout case only, wait this number of milliseconds
   * @returns {function|undefined}
   * @private
   */
  _requestNextFrame(callback, delay) { 
    // During unit testing, it happens that the mock window object is reset while
    // the next frame is still pending. Then, either 'window' is not present, or
    // 'requestAnimationFrame()' is not present because it is not defined on the
    // mock window object.
    //
    // As a consequence, unrelated unit tests may appear to fail, even if the problem
    // described happens in the current unit test.
    //
    // This is not something that will happen in normal operation, but we still need
    // to take it into account.
    //
    if (typeof window === 'undefined') return;  // Doing `if (window === undefined)` does not work here!

    let timer;

    var myWindow = window;  // Grab a reference to reduce the possibility that 'window' is reset
                            // while running this method.

    if (this.requiresTimeout === true) {
      // wait given number of milliseconds and perform the animation step function
      timer = myWindow.setTimeout(callback, delay);
    } else {
      if (myWindow.requestAnimationFrame) {
        timer = myWindow.requestAnimationFrame(callback);
      }
    }

    return timer;
  }

  /**
   *
   * @private
   */
  _startRendering() {
    if (this.renderingActive === true) {
      if (this.renderTimer === undefined) {
        this.renderTimer = this._requestNextFrame(this._renderStep.bind(this), this.simulationInterval);
      }
    }
  }

  /**
   *
   * @private
   */
  _renderStep() {
    if (this.renderingActive === true) {
      // reset the renderTimer so a new scheduled animation step can be set
      this.renderTimer = undefined;

      if (this.requiresTimeout === true) {
        // this schedules a new simulation step
        this._startRendering();
      }

      this._redraw();

      if (this.requiresTimeout === false) {
        // this schedules a new simulation step
        this._startRendering();
      }
    }
  }

  /**
   * Redraw the network with the current data
   * chart will be resized too.
   */
  redraw() {
    this.body.emitter.emit('setSize');
    this._redraw();
  }

  /**
   * Redraw the network with the current data
   * @private
   */
  _requestRedraw() {
    if (this.redrawRequested !== true && this.renderingActive === false && this.allowRedraw === true) {
      this.redrawRequested = true;
      this._requestNextFrame(() => {this._redraw(false);}, 0);
    }
  }

  /**
   * Redraw the network with the current data
   * @param {boolean} [hidden=false] | Used to get the first estimate of the node sizes.
   *                                   Only the nodes are drawn after which they are quickly drawn over.
   * @private
   */
  _redraw(hidden = false) {
    if (this.allowRedraw === true) {
      this.body.emitter.emit("initRedraw");

      this.redrawRequested = false;

      // when the container div was hidden, this fixes it back up!
      if (this.canvas.frame.canvas.width === 0 || this.canvas.frame.canvas.height === 0) {
        this.canvas.setSize();
      }

      this.canvas.setTransform();

      let ctx = this.canvas.getContext();

      // clear the canvas
      let w = this.canvas.frame.canvas.clientWidth;
      let h = this.canvas.frame.canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      // if the div is hidden, we stop the redraw here for performance.
      if (this.canvas.frame.clientWidth === 0) {
        return;
      }

      // set scaling and translation
      ctx.save();
      ctx.translate(this.body.view.translation.x, this.body.view.translation.y);
      ctx.scale(this.body.view.scale, this.body.view.scale);

      ctx.beginPath();
      this.body.emitter.emit("beforeDrawing", ctx);
      ctx.closePath();

      this._drawZones(this.canvas,ctx)
      if (hidden === false) {
        if (this.dragging === false || (this.dragging === true && this.options.hideEdgesOnDrag === false)) {
          this._drawEdges(ctx);
        }
      }

      if (this.dragging === false || (this.dragging === true && this.options.hideNodesOnDrag === false)) {
        this._drawNodes(ctx, hidden);
      }

      ctx.beginPath();
      this.body.emitter.emit("afterDrawing", ctx);
      ctx.closePath();


      // restore original scaling and translation
      ctx.restore();
      if (hidden === true) {
        ctx.clearRect(0, 0, w, h);
      }
    }
  }

  /**
   * Draw community zones
   * @param {CanvasRenderingContext2D} ctx
   * 
   */
  // _drawZones(ctx){
  //   var nodeList =[[[]]]
  //   nodeList[0] = [[1755,648],[1804,763],[1812,888],[1779,1010],[1707,1114],[1604,1188],[1484,1224],[1359,1218],[1244,1171],[1151,1066],[1067,1125],[967,1153],[863,1147],[766,1107],[688,1037],[637,945],[512,881],[464,769],[455,648],[486,531],[554,431],[651,359],[766,324],[879,323],[931,265],[987,195],[1063,147],[1151,127],[1242,136],[1324,174],[1389,237],[1482,254],[1528,332],[1649,361],[1710,445],[1740,544]]
  //   nodeList[1] = [[993,-98],[952,5],[879,90],[833,174],[729,210],[609,197],[579,280],[524,350],[448,398],[360,419],[271,409],[154,467],[41,454],[-61,404],[-127,311],[-206,228],[-252,124],[-262,11],[-235,-98],[-172,-192],[-83,-260],[-25,-321],[78,-335],[56,-460],[101,-548],[172,-616],[263,-648],[360,-724],[478,-765],[603,-764],[721,-722],[818,-644],[884,-537],[911,-416],[964,-318],[997,-210]]
  //   nodeList[2] = [[-385,195],[-358,311],[-371,430],[-423,538],[-509,622],[-584,712],[-645,841],[-762,899],[-891,915],[-1018,888],[-1128,820],[-1230,776],[-1335,743],[-1423,678],[-1485,587],[-1513,481],[-1505,372],[-1492,278],[-1563,195],[-1602,92],[-1605,-18],[-1571,-123],[-1561,-260],[-1485,-361],[-1380,-432],[-1280,-525],[-1149,-545],[-1018,-520],[-904,-453],[-819,-352],[-793,-195],[-714,-166],[-628,-131],[-557,-70],[-511,10],[-448,94]]
  //   nodeList[3] = [[2275,-394],[2269,-289],[2230,-191],[2160,-113],[2060,-69],[1986,-22],[1951,86],[1872,151],[1776,186],[1674,189],[1576,157],[1495,95],[1439,11],[1404,-72],[1341,-115],[1295,-175],[1173,-211],[1088,-290],[1034,-394],[1016,-510],[1038,-625],[1097,-726],[1186,-803],[1253,-894],[1356,-944],[1469,-957],[1579,-932],[1674,-873],[1751,-833],[1845,-865],[1945,-865],[2041,-831],[2120,-768],[2174,-683],[2197,-584],[2245,-495]]
  //   nodeList[4] = [[-749,1312],[-778,1401],[-835,1475],[-913,1526],[-1002,1548],[-1048,1592],[-1083,1659],[-1138,1711],[-1207,1743],[-1283,1714],[-1356,1724],[-1428,1710],[-1492,1673],[-1540,1618],[-1568,1551],[-1609,1501],[-1614,1432],[-1668,1380],[-1703,1312],[-1713,1236],[-1699,1161],[-1661,1094],[-1647,1006],[-1588,949],[-1513,914],[-1431,905],[-1352,924],[-1283,967],[-1233,1029],[-1182,1035],[-1100,996],[-1009,986],[-919,1006],[-840,1056],[-781,1129],[-749,1218]]
  //   nodeList[5] = [[796,-1385],[822,-1291],[815,-1192],[777,-1101],[711,-1028],[626,-981],[529,-964],[434,-980],[364,-942],[286,-949],[215,-980],[158,-1032],[134,-1120],[69,-1126],[9,-1152],[-39,-1196],[-71,-1254],[-83,-1320],[-138,-1385],[-147,-1461],[-131,-1537],[-91,-1603],[-32,-1653],[60,-1655],[83,-1737],[144,-1777],[222,-1750],[286,-1760],[350,-1747],[407,-1716],[450,-1668],[475,-1609],[477,-1545],[571,-1549],[662,-1522],[740,-1465]]
  //   nodeList[6] = [[-1337,-813],[-1385,-758],[-1448,-723],[-1519,-711],[-1587,-722],[-1567,-660],[-1586,-623],[-1616,-593],[-1653,-574],[-1696,-568],[-1748,-516],[-1805,-512],[-1861,-526],[-1910,-558],[-1946,-603],[-1938,-673],[-1969,-713],[-1987,-762],[-1989,-813],[-1974,-862],[-1945,-904],[-1904,-934],[-1903,-988],[-1871,-1022],[-1829,-1045],[-1783,-1053],[-1734,-1029],[-1696,-1090],[-1639,-1135],[-1570,-1159],[-1495,-1160],[-1424,-1136],[-1364,-1091],[-1322,-1029],[-1303,-956],[-1308,-881]]
  //   nodeList[7] = [[77,-817],[26,-717],[-3,-621],[-63,-541],[-151,-490],[-188,-397],[-253,-320],[-340,-268],[-440,-249],[-540,-263],[-630,-308],[-699,-381],[-740,-471],[-844,-454],[-885,-527],[-968,-570],[-1032,-637],[-1071,-723],[-1081,-817],[-1058,-908],[-1102,-1021],[-1071,-1123],[-1009,-1210],[-921,-1271],[-819,-1300],[-735,-1351],[-637,-1368],[-540,-1338],[-448,-1338],[-361,-1309],[-288,-1253],[-238,-1176],[-136,-1156],[-42,-1104],[29,-1024],[70,-924]]
  //   nodeList[8] = [[1729,1546],[1701,1649],[1642,1736],[1558,1799],[1459,1830],[1356,1826],[1255,1779],[1213,1800],[1167,1807],[1121,1872],[1059,1896],[992,1899],[948,1845],[876,1837],[839,1783],[777,1745],[730,1689],[703,1620],[701,1546],[722,1476],[764,1416],[823,1374],[891,1354],[915,1300],[956,1262],[1009,1238],[1055,1174],[1121,1172],[1184,1190],[1221,1271],[1309,1220],[1411,1201],[1514,1216],[1607,1266],[1678,1343],[1720,1441]]
  //   nodeList[9] = [[132,-2008],[98,-1921],[37,-1850],[-42,-1803],[-132,-1786],[-222,-1799],[-270,-1788],[-320,-1798],[-344,-1711],[-397,-1637],[-472,-1583],[-561,-1556],[-655,-1561],[-743,-1596],[-814,-1658],[-861,-1740],[-932,-1813],[-929,-1914],[-893,-2008],[-828,-2084],[-743,-2134],[-647,-2153],[-527,-2117],[-546,-2185],[-545,-2265],[-518,-2341],[-467,-2405],[-397,-2450],[-316,-2468],[-232,-2460],[-156,-2425],[-111,-2349],[-21,-2323],[54,-2269],[109,-2193],[136,-2102]]
  //   nodeList[10] = [[215,979],[249,1011],[293,1061],[319,1124],[323,1193],[304,1260],[264,1318],[207,1361],[139,1383],[68,1382],[2,1358],[-52,1314],[-90,1255],[-106,1188],[-99,1121],[-145,1103],[-186,1072],[-216,1030],[-231,979],[-229,927],[-210,878],[-177,837],[-134,809],[-91,789],[-72,734],[-37,688],[11,654],[68,639],[128,642],[183,664],[229,702],[259,752],[272,809],[265,866],[198,932],[178,960]]

  //   var colorList = ['rgba(135,206,250,0.2)','rgba(255,192,203,0.2)','rgba(230,230,250,0.5)','rgba(	100,149,237,0.2)','rgba(135,206,250,0.2)','rgba(127,255,170,0.2)','rgba(255,255,224,0.4)','rgba(255,228,181,0.2)','rgba(255,218,185,0.2)','rgba(250,128,114,0.2)','rgba(178,34,34,0.2)']
  //   for(let i=0;i<nodeList.length;i++){
  //     fillZone(ctx , nodeList[i],colorList[i]);
  //   }
    
  //   function fillZone(ctx, nodeList, fillColor, alpha){
  //     ctx.save();
  //     pathZone(ctx,nodeList)
  //     ctx.fillStyle = fillColor;
  //     //ctx.globalAlpha=0.2||alpha;
  //     ctx.fill();
  //     ctx.restore();
  //   }
  // function pathZone(ctx, nodeList){
  //     ctx.beginPath();
  //     ctx.moveTo(nodeList[0][0],nodeList[0][1]);
  //     for (let i=1;i<nodeList.length-1;i++){
  //         var node0 = nodeList[i]
  //         var node1 = nodeList[i+1]
  //         ctx.quadraticCurveTo(node0[0],node0[1],(node0[0]+node1[0])/2,(node0[1]+node1[1])/2)
          
  //     }
  //     //ctx.quadraticCurveTo((nodeList[0][0]+nodeList[nodeList.length-1][1])/2,(nodeList[0][1]+nodeList[nodeList.length-1][1])/2,nodeList[0][0],nodeList[0][1])
  //     ctx.lineTo(nodeList[nodeList.length-1][0],nodeList[nodeList.length-1][1])
  //     ctx.closePath();
  // }
  // }
  _drawZones(canvas,ctx){
    var nodeList = [[[]]]
    
    var groupSet = this.groups.groups
    var i = 0
    for (var item in groupSet){
      var temp = groupSet[item];
      nodeList[i] = temp.outlinePoints
      i++;
    }
    
    var colorList = ['rgba(135,206,250,0.2)','rgba(255,192,203,0.2)','rgba(230,230,250,0.5)','rgba(	100,149,237,0.2)','rgba(135,206,250,0.2)','rgba(127,255,170,0.2)','rgba(255,255,224,0.4)','rgba(255,228,181,0.2)','rgba(255,218,185,0.2)','rgba(250,128,114,0.2)','rgba(178,34,34,0.2)']
    for(let i=0;i<nodeList.length;i++){
      fillZone(ctx , nodeList[i],colorList[i]);
    }
    
    function fillZone(ctx, nodeList, fillColor, alpha){
      
      if(nodeList !== undefined) {
        ctx.save();
        pathZone(ctx,nodeList);
        ctx.fillStyle = fillColor || 'rgba(135,206,250,0.2)';
        //ctx.globalAlpha=0.2||alpha;
        ctx.fill();
        ctx.restore();
      }
      
     
    }
  function pathZone(ctx, nodeList){
      ctx.beginPath();
      ctx.moveTo(nodeList[0][0],nodeList[0][1]);
      for (let i=1;i<nodeList.length-1;i++){
          var node0 = nodeList[i]
          var node1 = nodeList[i+1]
          ctx.quadraticCurveTo(node0[0],node0[1],(node0[0]+node1[0])/2,(node0[1]+node1[1])/2)
          
      }
      //ctx.quadraticCurveTo((nodeList[0][0]+nodeList[nodeList.length-1][1])/2,(nodeList[0][1]+nodeList[nodeList.length-1][1])/2,nodeList[0][0],nodeList[0][1])
      ctx.lineTo(nodeList[nodeList.length-1][0],nodeList[nodeList.length-1][1])
      ctx.closePath();
  }
  }
  

  /**
   * Redraw all nodes
   *
   * @param {CanvasRenderingContext2D}   ctx
   * @param {boolean} [alwaysShow]
   * @private
   */
  _resizeNodes() {
    this.canvas.setTransform();
    let ctx = this.canvas.getContext();
    ctx.save();
    ctx.translate(this.body.view.translation.x, this.body.view.translation.y);
    ctx.scale(this.body.view.scale, this.body.view.scale);

    let nodes = this.body.nodes;
    let node;

    // resize all nodes
    for (let nodeId in nodes) {
      if (nodes.hasOwnProperty(nodeId)) {
        node = nodes[nodeId];
        node.resize(ctx);
        node.updateBoundingBox(ctx, node.selected);
      }
    }

    // restore original scaling and translation
    ctx.restore();
  }

  /**
   * Redraw all nodes
   *
   * @param {CanvasRenderingContext2D} ctx  2D context of a HTML canvas
   * @param {boolean} [alwaysShow]
   * @private
   */
  _drawNodes(ctx, alwaysShow = false) {
    let nodes = this.body.nodes;
    let nodeIndices = this.body.nodeIndices;
    let node;
    let selected = [];
    let margin = 20;
    let topLeft = this.canvas.DOMtoCanvas({x:-margin,y:-margin});
    let bottomRight = this.canvas.DOMtoCanvas({
      x: this.canvas.frame.canvas.clientWidth+margin,
      y: this.canvas.frame.canvas.clientHeight+margin
    });
    let viewableArea = {top:topLeft.y,left:topLeft.x,bottom:bottomRight.y,right:bottomRight.x};

    // draw unselected nodes;
    for (let i = 0; i < nodeIndices.length; i++) {
      
      node = nodes[nodeIndices[i]];
      //console.log(node.id,node.x,node.y)
      // set selected nodes aside
      if (node.isSelected()) {
        selected.push(nodeIndices[i]);
      }
      else {
        if (alwaysShow === true) {
          node.draw(ctx);
        }
        else if (node.isBoundingBoxOverlappingWith(viewableArea) === true) {
          node.draw(ctx);
        }
        else {
          node.updateBoundingBox(ctx, node.selected);
        }
      }
    }

    // draw the selected nodes on top
    for (let i = 0; i < selected.length; i++) {
      node = nodes[selected[i]];
      node.draw(ctx);
    }
  }


  /**
   * Redraw all edges
   * @param {CanvasRenderingContext2D} ctx  2D context of a HTML canvas
   * @private
   */
  _drawEdges(ctx) {
    let edges = this.body.edges;
    let edgeIndices = this.body.edgeIndices;
    let edge;

    for (let i = 0; i < edgeIndices.length; i++) {
      edge = edges[edgeIndices[i]];
      if (edge.connected === true) {
        edge.draw(ctx);
      }
    }
  }

  /**
   * Determine if the browser requires a setTimeout or a requestAnimationFrame. This was required because
   * some implementations (safari and IE9) did not support requestAnimationFrame
   * @private
   */
  _determineBrowserMethod() {
    if (typeof window !== 'undefined') {
      let browserType = navigator.userAgent.toLowerCase();
      this.requiresTimeout = false;
      if (browserType.indexOf('msie 9.0') != -1) { // IE 9
        this.requiresTimeout = true;
      }
      else if (browserType.indexOf('safari') != -1) {  // safari
        if (browserType.indexOf('chrome') <= -1) {
          this.requiresTimeout = true;
        }
      }
    }
    else {
      this.requiresTimeout = true;
    }
  }
}

export default CanvasRenderer;
