---
title: JHipster快速开发Web应用
tags:
  - SpringBoot
  - JHipster
  - 微服务
date: 2018-02-01 16:39:24
---


>在基于Spring的Web项目开发中，通常存在两个问题：
>1. 普通CRUD的代码基本重复，完全是体力活；
>2. Controller层和持久层之间的数据传递，存在不规范。有人喜欢直接返回JSON，有人喜欢用DTO，有人喜欢直接Entity。
>
那如何解决这个问题呢？自动生成呗。一群喜欢动脑筋（懒）的人，发明了JHipster。<img src="/images/2018/02/logo-jhipster.svg" style="display: inline-block;" width=65 height=65/>

>[JHipster](http://www.jhipster.tech)是一个基于SpringBoot和Angular的快速Web应用和SpringCloud微服务的脚手架。本文将介绍如何利用JHipster快速开发Web应用。

## 安装JHipster
JHipster支持好几种安装方式，这里选用最方便的一种方式：Yarn
##### 1. 安装[Java8](http://www.oracle.com/technetwork/java/javase/downloads/index.html)；
##### 2. 安装[Node.js](http://nodejs.org/)
##### 3. 安装[Yarn](https://yarnpkg.com/en/docs/install)
##### 4. 安装JHipster： `yarn global add generator-jhipster`

## 创建Web应用
##### 1. 创建项目目录
##### 2. 为一些被墙的资源添加国内源
在项目目录下创建`.npmrc`文件，为该项目特指一些源。（当然，你也可以为Node和Yarn指定全局的源，那就可以跳过这一步）
```text
sass_binary_site=https://npm.taobao.org/mirrors/node-sass/
phantomjs_cdnurl=https://npm.taobao.org/mirrors/phantomjs/
electron_mirror=https://npm.taobao.org/mirrors/electron/
registry=https://registry.npm.taobao.org
```
##### 3. 在项目目录下运行命令`jhipster`初始化
```yml 
    (1/16) Which *type* of application would you like to create? (Use arrow keys)
  > Monolithic application (recommended for simple projects) 
    //传统Web应用
    Microservice application
    //微服务
    Microservice gateway
    //微服务网关
    
    (2/16) What is the base name of your application? (jhipster) jhipster_quick_start
    //输入项目名称，对应Maven的 artifactId
    
    (3/16) What is your default Java package name? (com.chimestone) com.edi
    //输入默认包名，对应Maven的 groupId
    
    (4/16) Do you want to use the JHipster Registry to configure, monitor and scale your application? (Use arrow keys)
  > No
    Yes
    //选择是否启用JHipster Registry（微服务默认开启），它可以理解为Eureka、Spring Cloud Config Server、Spring Cloud Admin的一个合体
    
    (5/16) Which *type* of authentication would you like to use? (Use arrow keys)
    JWT authentication (stateless, with a token)
  > HTTP Session Authentication (stateful, default Spring Security mechanism)
    OAuth2 Authentication (stateless, with an OAuth2 server implementation)
    //选择认证方式，支持JWT、Session和OATUH2三种
    
    (6/16) Which *type* of database would you like to use? (Use arrow keys)
  > SQL (H2, MySQL, MariaDB, PostgreSQL, Oracle, MSSQL)
    MongoDB
    Cassandra
    //选择数据库类型
    
    (7/16) Which *production* database would you like to use? (Use arrow keys)
  > MySQL
    MariaDB
    PostgreSQL
    Oracle (Please follow our documentation to use the Oracle proprietary driver)
    Microsoft SQL Server
    //选择数据库
    
    (8/16) Which *development* database would you like to use?
    H2 with disk-based persistence
  > H2 with in-memory persistence
    MySQL
    //选择开发时连接的数据库，这里选H2只是为了演示
    
    (9/16) Do you want to use Hibernate 2nd level cache? (Use arrow keys)
  > Yes, with ehcache (local cache, for a single node)
    Yes, with HazelCast (distributed cache, for multiple nodes)
    [BETA] Yes, with Infinispan (hybrid cache, for multiple nodes)
    No
    //选择集成到Hibernate2级缓存
    
    (10/16) Would you like to use Maven or Gradle for building the backend? (Use arrow keys)
  > Maven
    Gradle
    //选择打包工具
    
    (11/16) Which other technologies would you like to use?
    ( ) Social login (Google, Facebook, Twitter)
    (*) Search engine using Elasticsearch
   >(*) WebSockets using Spring Websocket
    ( ) API first development using swagger-codegen
    ( ) [BETA] Asynchronous messages using Apache Kafka
    //选择其他的集成框架，这里注意要按下空格键才是启用，启用后会加上*标识。看到无脑自动集成ES是不是泪流满面？
    
    (12/16) Which *Framework* would you like to use for the client? (Use arrow keys)
  > Angular 4
    AngularJS 1.x
    //选择集成的Angular的版本，Angular4采用Webpack打包自动化，而1.x采用Bower和Gulp做自动化
    
    (13/16) Would you like to use the LibSass stylesheet preprocessor for your CSS? (y/N) y
    //是否启用LibSass
    
    (14/16) Would you like to enable internationalization support? (Y/n) n
    //是否开启国际化
    
    (15/16) Besides JUnit and Karma, which testing frameworks would you like to use? (Press <space> to select, <a> to toggle all, <i> to inverse selection)
   >( ) Gatling
    ( ) Cucumber
    ( ) Protractor
    //选择测试框架，做压力测试的同学有福了
    
    (16/16) Would you like to install other generators from the JHipster Marketplace? (y/N)
    //从JHipster市场下载一些其他集成，上下键翻动，空格选取/反选，回车结束。可以看到市场里还是有不少好东西的，像pages服务、ReactNative集成、swagger2markup让你的swagger界面更漂亮、gRPC自动CRUD代码等。
    ```
全部选择后，就开始了自动执行生成项目，喝杯水坐等。**如果没有翻墙且忘了添加第二步的同学，请坐等卡住。**
    
## 基本姿势
对于普通Web应用，JHipster在SpringBoot中默认加载了`SpringMVC`、`SpringData`、`SpringJPA`、`SpringSecurity`几个主要的Web相关的家族成员，LogStash作为日志工具，同时引入了`ApacheCommons`包、`Swagger`、`HikariCP`数据库连接池、`Jackson`等工具。基本上开发一个JavaWeb项目所需的框架都具备了，甚至还引入了`Metrics`做运维监控。
此外，它还引入两个特殊的组件——`Liquibase`和`MapperStruct`。
- [Liquibase](liquibase.org)是一个帮助管理数据库变更的工具
- [MapperStruct](http://mapstruct.org/)用于自动生成Entity和对应DTO之间的映射关系类，**在使用DTO时，千万记得要把自动生成的目录加到IDE的项目路径里**！

国内搞JavaWeb的，大都喜欢使用`Mybatis`，可惜的是JHipster默认并不提供`Mybatis`的集成。但是`SpringJPA`现在已经封装的十分完善，常规的CRUD和分页，在JHipster下，无需写一行代码（是的，你没看错）。 
如果确实需要比较复杂的级联查询，JPA也提供了Specification和Sample实现，性能测试下来其实没多大区别，对付普通Web足以。
如果确实不喜欢JPA，好在SpringBoot本身可以同时使用JPA和Mybatis，那么就把复杂级联用Mybatis，普通CRUD用JPA，达到最佳效果。

##### 代码结构
- **Entity**
JHipster自动产生的项目，内置了`User`、`Authority`、`PersistentToken`、`PersistentAuditEvent`四个Entity（如果选取的还有其他组件，如OAUTH2等，会有对应的Entity自动生成）。产生的几张表均以`jhi_`开头。如果启用了ES，那么除了`@Entity`注解外，你还会看到`@Document`注解。
这里值得一提的是，官方并不推荐修改默认的表名，而且如果要更改User的字段，官方推荐使用创建一个子类继承User类，然后在该子类中把User给Map进来，参见[这里](http://www.jhipster.tech/tips/022_tip_registering_user_with_additional_information.html)。但其实完全自己修改，然后更新数据库字段后，用Liquibase diff命令生成changelog。

- **Controller**
JHipster自动生成的Controller暴露出的RESTful接口都是[标准的RESTful API风格](http://www.ruanyifeng.com/blog/2014/05/restful_api.html)，国内很多程序员都不在乎这个东西，导致代码风格及其粗狂。

- **Repository**
这一块得益于SpringJPA的强大，一个JpaRepository接口足以满足大多数需求，有些懒人甚至连Controller都懒得写，给Repository接口加上`@RepositoryRestResource`注解直接暴露RESTful接口出去。

##### 开始表演
熟悉了代码结构后，我们开始用JHipster来做项目了。
1. 创建JDL文件描述Entity
JHipster默认提供了以下几种类型及校验关键字：

类型 | 校验 | 备注
-- | --: | --:
String | required, minlength, maxlength, pattern  | Java String类型，默认长度取决于使用的底层技术，JPA默认是255长，可以用validation rules修改到1024
Integer | required, min, max |
Long | required, min, max |
BigDecimal | required, min, max |
Float | required, min, max |
Double | required, min, max |
Enum | required |
Boolean | required |
LocalDate | required | 对应`java.time.LocalDate`类
Instant | required | 对应`java.time.Instant`类，DB中映射为`Timestamp`
ZonedDateTime | required | 对应`java.time.ZonedDateTime`类，用于需要提供TimeZone的日期
Blob | required, minbytes, maxbytes |

官方提供了一个在线的[JDL Studio](https://start.jhipster.tech/jdl-studio/)，方便撰写JDL。
例子如下：

```JSON
    //双斜杠注释会被忽略掉
    /** 这种注释会带到生成的代码里去 */
    entity Person {
        name String required,
        sex Sex
    }
    
    enum Sex {
        MALE, FEMALE
    }
    
    entity Country{
        countryName String
    }
    
    relationship ManyToOne {
        Person{country} to Country
    }
    
    paginate Person with pagination
    paginate Country with infinite-scroll
    
```
2. 用`jhipster import-jdl your-jdl-file.jdl`导入Entity。
中间会提示有`conflict`，因为像Cache配置、LiquidBase配置等是已存在的，可以覆盖或merge。
执行完毕后，看到代码已经生成进去了。

```java
package com.edi.domain;
import ...
/**
 * 这种注释会带到生成的代码里去
 */
@ApiModel(description = "这种注释会带到生成的代码里去")
@Entity
@Table(name = "person")
@Cache(usage = CacheConcurrencyStrategy.NONSTRICT_READ_WRITE)
@Document(indexName = "person")
public class Person implements Serializable {

    private static final long serialVersionUID = 1L;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @NotNull
    @Column(name = "name", nullable = false)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(name = "sex")
    private Sex sex;

    @ManyToOne
    private Country country;

    // jhipster-needle-entity-add-field - Jhipster will add fields here, do not remove
    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public Person name(String name) {
        this.name = name;
        return this;
    }

    public void setName(String name) {
        this.name = name;
    }

    public Sex getSex() {
        return sex;
    }

    public Person sex(Sex sex) {
        this.sex = sex;
        return this;
    }

    public void setSex(Sex sex) {
        this.sex = sex;
    }

    public Country getCountry() {
        return country;
    }

    public Person country(Country country) {
        this.country = country;
        return this;
    }

    public void setCountry(Country country) {
        this.country = country;
    }
    // jhipster-needle-entity-add-getters-setters - Jhipster will add getters and setters here, do not remove
    ...
```

看到有段注释带进去了。
再看下Controller
```java
package com.edi.web.rest;
import ...
/**
 * REST controller for managing Person.
 */
@RestController
@RequestMapping("/api")
public class PersonResource {
 ... 
    /**
     * GET  /people : get all the people.
     *
     * @param pageable the pagination information
     * @return the ResponseEntity with status 200 (OK) and the list of people in body
     */
    @GetMapping("/people")
    @Timed
    public ResponseEntity<List<Person>> getAllPeople(@ApiParam Pageable pageable) {
        log.debug("REST request to get a page of People");
        Page<Person> page = personRepository.findAll(pageable);
        HttpHeaders headers = PaginationUtil.generatePaginationHttpHeaders(page, "/api/people");
        return new ResponseEntity<>(page.getContent(), headers, HttpStatus.OK);
    }
    
    /**
     * SEARCH  /_search/people?query=:query : search for the person corresponding
     * to the query.
     *
     * @param query the query of the person search
     * @param pageable the pagination information
     * @return the result of the search
     */
    @GetMapping("/_search/people")
    @Timed
    public ResponseEntity<List<Person>> searchPeople(@RequestParam String query, @ApiParam Pageable pageable) {
        log.debug("REST request to search for a page of People for query {}", query);
        Page<Person> page = personSearchRepository.search(queryStringQuery(query), pageable);
        HttpHeaders headers = PaginationUtil.generateSearchPaginationHttpHeaders(query, page, "/api/_search/people");
        return new ResponseEntity<>(page.getContent(), headers, HttpStatus.OK);
    }
}
```
其他的不一一列举了，这里着重看下上面两个实现，一个是分页返回列表，一个是ES搜索。
分页这里与我们常规有所不同，它是把分页信息通过`PaginationUtil.generatePaginationHttpHeaders(page, "/api/people");`这里生成到`Header`里去了，前端需要从Header里取。

##### 自定义修改返回类型(Optional)
好吧，看到上面肯定有同学要说了，我们平时分页都是返回JSON，所有数据都是返回JSON！
如果非得这么做，那就只能自己做个ResponseUtil，把结果包装成如下格式

```json
{
    "success": true,
    "data":{
        "content": [{
            "name": "张三",
            "country": "中国",
            "sex": "MALE"
        }]
    },
    "code": 200
}```
只需增加两个新类：
`CommonResponse`
```java
public class CommonResponse<T> {

    public static final int DEFAULT_CODE = 200;

    private boolean success;
    private T data;
    private int code=DEFAULT_CODE;

    public CommonResponse() {
    }

    public CommonResponse(boolean success, T data) {
        this.success = success;
        this.data = data;
    }

    public CommonResponse(boolean success, T data, int code) {
        this.success = success;
        this.data = data;
        this.code = code;
    }

    ... //get & set
}
```

`ResponseUtil`
```java
public class ResponseUtil {

    private static final Logger LOGGER = LoggerFactory.getLogger(ResponseUtil.class);

    private ResponseUtil() {
    }

    public static ResponseEntity<CommonResponse> okResponse(){
        return wrapResponse(true, null, DEFAULT_CODE);
    }

    public static <T> ResponseEntity<CommonResponse> wrapResponse(int statusCode){
        return wrapResponse(true, null, statusCode);
    }

    public static <T> ResponseEntity<CommonResponse> wrapResponse(T data){
        return wrapResponse(true, data, DEFAULT_CODE);
    }

    public static <T> ResponseEntity<CommonResponse> wrapResponse(T data, Pageable pageable){
        return wrapResponse(true, data, DEFAULT_CODE);
    }

    public static <T> ResponseEntity<CommonResponse> wrapResponse(T data, int statusCode){
        return wrapResponse(true, data, statusCode);
    }

    public static <T> ResponseEntity<CommonResponse> wrapResponse(boolean successful,T data){
        return wrapResponse(true, data, DEFAULT_CODE);
    }

    public static <T> ResponseEntity<CommonResponse> wrapResponse(boolean successful, int statusCode){
        return wrapResponse(true, null, statusCode);
    }

    public static <T> ResponseEntity<CommonResponse> wrapResponse(boolean successful, T data, int statusCode){
        return ResponseEntity.ok(new CommonResponse<>(successful, data, statusCode));
    }

    public static <T> ResponseEntity<CommonResponse> wrapResponse(boolean successful,
                                                                  Optional<T> maybeResponse,
                                                                  HttpHeaders headers,
                                                                  int statusCode){
        return (ResponseEntity)maybeResponse.map((response) -> {
            CommonResponse<T> commonResponse = new CommonResponse<>(successful, response, statusCode);
            return ((ResponseEntity.BodyBuilder)ResponseEntity.ok().headers(headers)).body(commonResponse);
        }).orElse(new ResponseEntity(new CommonResponse<>(successful, null, HttpStatus.NOT_FOUND.value()), HttpStatus.NOT_FOUND));
    }

    public static <T> ResponseEntity<CommonResponse> wrapOrNotFound(Optional<T> maybeResponse){
        return wrapResponse(true, maybeResponse, null, DEFAULT_CODE);
    }
}
```

然后修改下Controller里面的返回为如下即可
```java
    @GetMapping("/people")
    @Timed
    public ResponseEntity<List<Person>> getAllPeople(@ApiParam Pageable pageable) {
        log.debug("REST request to get a page of People");
        Page<Person> page = personRepository.findAll(pageable);
        //HttpHeaders headers = PaginationUtil.generatePaginationHttpHeaders(page, "/api/people");
        //return new ResponseEntity<>(page.getContent(), headers, HttpStatus.OK);
        return ResponseUtil.wrapResponse(page);
    }
```

##### 打包运行
先执行`yarn install && bower install` (Angular 1.x版本) 或 `yarn install`(Angular 4版本)对前端代码进行编译。
然后可选：
- 命令行运行 ./mvnw 
- 带LiveReload前端调试 gulp (Angular1.x版本)或yarn start(Angular 4版本)
- 生产编译 ./mvnw clean package -Pprod

启动后，默认在本地8080端口启动JHipster的页面，看到已经用它自己的模板实现了常规页面。我们需要做的只是自己做套Angluar页面，套用该模板下的请求处理就好了。

## 高级姿势
##### Docker集成
在/src/main/docker/目录下，JHipster提供了docker化所需的所有文件，所以开箱即用。例如，
- 启动一个mysql数据库： `docker-compose -f src/main/docker/mysql.yml up -d`
- 停止并删除该mysql数据库： `docker-compose -f src/main/docker/mysql.yml down`
- Maven将本项目打包成docker镜像： `./mvnw package -Pprod dockerfile:build`
- 启动项目容器： `docker-compose -f src/main/docker/app.yml up -d`

如果需要maven打包docker镜像后推到Registry，则需要修改pom.xml，将`dockerfile-maven-plugin`中注释掉的一段给打开。

##### CI集成
(留坑)

## 结束语
正常情况下，用`Jhipster`快速实现普通的JavaWeb项目其实仅需三步：1.初始化项目；2.用JDL创建自己的Entity；3.导入JDL；
作为一个脚手架，使用起来已经非常方便了，而且它还支持微服务项目。
既然谈到脚手架，不由自主的会与JFinal等其他脚手架对比，JHipster不一定比其他脚手架轻快，但好在代码规范，Spring家族全套，回头看看，确实可以解决文初的那两个问题。